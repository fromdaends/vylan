// QuickBooks reference-data cache — Stage 2, Phase 4 data layer.
//
// READS of the cached lists + sync state go through the AUTHENTICATED client so
// RLS scopes them to the firm (this data is non-secret; migration 0420 grants
// firm members SELECT). WRITES (the background sync job) go through the SERVICE
// role. Everything degrades gracefully (isMissingSchema) before 0420 is applied.

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import {
  isMissingSchema,
  runWithClientFallback,
  withClientScope,
  type QuickbooksClientScope,
} from "@/lib/db/quickbooks";
import { isSellableItem } from "@/lib/quickbooks/suggest";
import type {
  QbAccount,
  QbItem,
  QbNamed,
  QuickbooksLists,
} from "@/lib/quickbooks/read";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuickbooksSyncStatus = "idle" | "syncing" | "ok" | "error";
export type FirmSyncState = {
  lastSyncedAt: string | null;
  status: QuickbooksSyncStatus;
  error: string | null;
};

function normalizeStatus(v: unknown): QuickbooksSyncStatus {
  return v === "syncing" || v === "ok" || v === "error" ? v : "idle";
}

// Read the firm's sync bookkeeping (authenticated, RLS). Returns null when the
// 0420 columns/row aren't there yet OR the firm isn't connected.
export async function getFirmSyncState(
  clientId?: QuickbooksClientScope,
): Promise<FirmSyncState | null> {
  const sb = await getServerSupabase();
  // Sync bookkeeping lives on the connection ROW, which is now per-client (0710),
  // so a clientId targets that client's connection's sync state.
  const base = () =>
    sb
      .from("quickbooks_connections")
      .select("last_synced_at, sync_status, sync_error");
  const { data, error } = await runWithClientFallback(
    () => withClientScope(base(), clientId).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] getFirmSyncState failed:", error);
    }
    return null;
  }
  if (!data) return null;
  return {
    lastSyncedAt: (data.last_synced_at as string | null) ?? null,
    status: normalizeStatus(data.sync_status),
    error: (data.sync_error as string | null) ?? null,
  };
}

function toCachedAccount(r: Record<string, unknown>): QbAccount {
  return {
    id: String(r.qbo_id ?? ""),
    name: (r.name as string | null) ?? "",
    accountType: (r.account_type as string | null) ?? null,
    active: r.active !== false,
  };
}
function toCachedNamed(r: Record<string, unknown>): QbNamed {
  return {
    id: String(r.qbo_id ?? ""),
    name: (r.name as string | null) ?? "",
    active: r.active !== false,
  };
}
function toCachedItem(r: Record<string, unknown>): QbItem {
  return {
    id: String(r.qbo_id ?? ""),
    name: (r.name as string | null) ?? "",
    itemType: (r.item_type as string | null) ?? null,
    incomeAccountId: (r.income_account_qbo_id as string | null) ?? null,
    active: r.active !== false,
  };
}

// Read the cached Items list TOLERANTLY: a missing quickbooks_items table
// (before migration 0460) or any read error returns null ("no items yet")
// instead of failing — so adding items never breaks the four core lists. Pass a
// firmId for the service-role variant (no RLS scoping).
async function readCachedItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  firmId?: string,
  clientId?: QuickbooksClientScope,
): Promise<QbItem[] | null> {
  const base = () => {
    let q = sb
      .from("quickbooks_items")
      .select("qbo_id, name, item_type, income_account_qbo_id, active");
    if (firmId) q = q.eq("firm_id", firmId);
    return q;
  };
  const { data, error } = await runWithClientFallback(
    () => withClientScope(base(), clientId),
    () => base(),
  );
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] readCachedItems failed:", error);
    }
    return null;
  }
  // Hide non-sellable items (QuickBooks "Category" groupings, Bundles) from every
  // consumer — the accountant's item picker AND the matcher. An Invoice line whose
  // ItemRef points at a category is rejected by QuickBooks ("an item in this
  // transaction is set up as a category instead of a product or service").
  return (data ?? [])
    .map(toCachedItem)
    .filter((i) => isSellableItem(i.itemType));
}

// Read the firm's cached lists (authenticated, RLS firm-scoped). Returns null
// when the cache tables don't exist yet (caller falls back to a live read).
export async function readCachedQuickbooksLists(
  clientId?: QuickbooksClientScope,
): Promise<QuickbooksLists | null> {
  const sb = await getServerSupabase();
  const fetch = (scopeOn: boolean) => {
    const scope = <Q>(q: Q): Q => (scopeOn ? withClientScope(q, clientId) : q);
    return Promise.all([
      scope(
        sb
          .from("quickbooks_accounts")
          .select("qbo_id, name, account_type, active"),
      ),
      scope(sb.from("quickbooks_vendors").select("qbo_id, name, active")),
      scope(sb.from("quickbooks_customers").select("qbo_id, name, active")),
      scope(sb.from("quickbooks_tax_codes").select("qbo_id, name, active")),
    ]);
  };
  // Always try the client-scoped read first; degrade to the no-filter read when
  // the client_id column isn't there yet (pre-0710).
  let [acc, ven, cus, tax] = await fetch(true);
  if ([acc, ven, cus, tax].some((r) => r.error && isMissingSchema(r.error))) {
    [acc, ven, cus, tax] = await fetch(false);
  }
  for (const r of [acc, ven, cus, tax]) {
    if (r.error) {
      if (!isMissingSchema(r.error)) {
        console.error(
          "[quickbooks] readCachedQuickbooksLists failed:",
          r.error,
        );
      }
      return null;
    }
  }
  return {
    accounts: (acc.data ?? []).map(toCachedAccount),
    vendors: (ven.data ?? []).map(toCachedNamed),
    customers: (cus.data ?? []).map(toCachedNamed),
    taxCodes: (tax.data ?? []).map(toCachedNamed),
    items: await readCachedItems(sb, undefined, clientId),
  };
}

// Service-role read of a firm's cached lists BY firm id — for background workers
// (e.g. the classify worker generating a draft suggestion) that have no
// authenticated session, so RLS / current_firm_id() can't scope them. Mirrors
// readCachedQuickbooksLists but filters explicitly by firm_id. Returns null when
// the cache tables don't exist yet (pre-0420).
export async function readCachedQuickbooksListsForFirm(
  firmId: string,
  clientId?: QuickbooksClientScope,
): Promise<QuickbooksLists | null> {
  const sb = getServiceRoleSupabase();
  const fetch = (scopeOn: boolean) => {
    const scope = <Q>(q: Q): Q => (scopeOn ? withClientScope(q, clientId) : q);
    return Promise.all([
      scope(
        sb
          .from("quickbooks_accounts")
          .select("qbo_id, name, account_type, active")
          .eq("firm_id", firmId),
      ),
      scope(
        sb
          .from("quickbooks_vendors")
          .select("qbo_id, name, active")
          .eq("firm_id", firmId),
      ),
      scope(
        sb
          .from("quickbooks_customers")
          .select("qbo_id, name, active")
          .eq("firm_id", firmId),
      ),
      scope(
        sb
          .from("quickbooks_tax_codes")
          .select("qbo_id, name, active")
          .eq("firm_id", firmId),
      ),
    ]);
  };
  // Always try the client-scoped read first; degrade to the no-filter read when
  // the client_id column isn't there yet (pre-0710).
  let [acc, ven, cus, tax] = await fetch(true);
  if ([acc, ven, cus, tax].some((r) => r.error && isMissingSchema(r.error))) {
    [acc, ven, cus, tax] = await fetch(false);
  }
  for (const r of [acc, ven, cus, tax]) {
    if (r.error) {
      if (!isMissingSchema(r.error)) {
        console.error(
          "[quickbooks] readCachedQuickbooksListsForFirm failed:",
          r.error,
        );
      }
      return null;
    }
  }
  return {
    accounts: (acc.data ?? []).map(toCachedAccount),
    vendors: (ven.data ?? []).map(toCachedNamed),
    customers: (cus.data ?? []).map(toCachedNamed),
    taxCodes: (tax.data ?? []).map(toCachedNamed),
    items: await readCachedItems(sb, firmId, clientId),
  };
}

// ── Service-role writers (the sync job) ──────────────────────────────────────

export type SetSyncStateInput = {
  status: QuickbooksSyncStatus;
  error?: string | null;
  // Only set when a sync produced fresh data; omit to leave it untouched.
  lastSyncedAt?: string | null;
};

export async function setFirmSyncState(
  firmId: string,
  input: SetSyncStateInput,
  clientId?: QuickbooksClientScope,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const patch: Record<string, unknown> = {
    sync_status: input.status,
    sync_error: input.error ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.lastSyncedAt !== undefined)
    patch.last_synced_at = input.lastSyncedAt;
  // Sync state lives on the connection ROW, now per-client (0710): undefined/null
  // targets the firm-level row (client_id IS NULL), a uuid that client's row.
  const base = () =>
    sb.from("quickbooks_connections").update(patch).eq("firm_id", firmId);
  const { error } = await runWithClientFallback(
    () => withClientScope(base(), clientId),
    () => base(),
  );
  if (error && !isMissingSchema(error)) {
    console.error("[quickbooks] setFirmSyncState failed:", error);
  }
}

const TABLE_BY_ENTITY = {
  accounts: "quickbooks_accounts",
  vendors: "quickbooks_vendors",
  customers: "quickbooks_customers",
  taxCodes: "quickbooks_tax_codes",
  items: "quickbooks_items",
} as const;

export type CacheEntity = keyof typeof TABLE_BY_ENTITY;

type CacheRow = {
  id: string;
  name: string;
  active: boolean;
  accountType?: string | null;
  itemType?: string | null;
  incomeAccountId?: string | null;
};

// Replace a firm's cached rows for one entity: upsert the fresh rows (stamped
// with `syncedAt`), then prune any row NOT refreshed this sync (i.e. removed from
// QuickBooks). Upsert-then-prune avoids a momentarily-empty list. Service role.
//
// Robustness notes: a mid-chunk failure throws before the prune, so a few stale
// rows can linger — but the cron retries the sync (markJobFailed) and the next
// clean run prunes them. Two concurrent syncs are safe: the upsert is idempotent
// (onConflict firm_id,qbo_id) and both re-stamp the same qbo_ids, so neither
// prunes the other's rows. Always firm-scoped, so it can only ever touch one
// firm's cache.
export async function replaceCachedEntity(
  firmId: string,
  entity: CacheEntity,
  rows: CacheRow[],
  syncedAt: string,
  clientId?: QuickbooksClientScope,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const table = TABLE_BY_ENTITY[entity];
  // Firm-level rows carry client_id NULL; a specific client's rows carry its id.
  const clientValue = clientId ?? null;
  // One full upsert-then-prune pass. `useClientId` = the post-0710 path: conflict
  // on (firm_id, client_id, qbo_id), set client_id, and prune only within this
  // client's slice. `false` = the pre-0710 legacy path: conflict on (firm_id,
  // qbo_id), omit client_id, prune the whole firm. Returns schemaMiss (instead of
  // throwing) when the client-inclusive pass fails on a missing client_id column.
  const run = async (useClientId: boolean): Promise<{ schemaMiss: boolean }> => {
    const onConflict = useClientId
      ? "firm_id,client_id,qbo_id"
      : "firm_id,qbo_id";
    const records = rows.map((r) => ({
      firm_id: firmId,
      ...(useClientId ? { client_id: clientValue } : {}),
      qbo_id: r.id,
      name: r.name,
      active: r.active,
      ...(entity === "accounts" ? { account_type: r.accountType ?? null } : {}),
      ...(entity === "items"
        ? {
            item_type: r.itemType ?? null,
            income_account_qbo_id: r.incomeAccountId ?? null,
          }
        : {}),
      synced_at: syncedAt,
    }));
    // Upsert in chunks so a very large company can't exceed request limits.
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error } = await sb.from(table).upsert(chunk, { onConflict });
      if (error) {
        if (useClientId && isMissingSchema(error)) return { schemaMiss: true };
        throw error;
      }
    }
    // Prune rows whose qbo_id vanished from QuickBooks since this sync started.
    let del = sb
      .from(table)
      .delete()
      .eq("firm_id", firmId)
      .lt("synced_at", syncedAt);
    if (useClientId) del = withClientScope(del, clientValue);
    const { error: delErr } = await del;
    if (delErr) {
      if (useClientId && isMissingSchema(delErr)) return { schemaMiss: true };
      throw delErr;
    }
    return { schemaMiss: false };
  };

  // PRIMARY (post-0710): always the client-inclusive pass. FALLBACK (pre-0710):
  // the client_id column is absent, so replace firm-only.
  const primary = await run(true);
  if (primary.schemaMiss) await run(false);
}

// Append/refresh ONE cached row WITHOUT the destructive prune replaceCachedEntity
// does — for when the accountant creates a single entity inline (a Vendor/Customer
// from the draft-card picker). The new row must land in the cache immediately so
// the draft is postable (checkBillPostable requires the party to be an ACTIVE
// cached row) and the entity shows in the picker, all without disturbing the rest
// of the firm's cache. Service role; firm-scoped. Best-effort: a missing cache
// table (pre-0420) is a no-op, mirroring the rest of this module.
export async function upsertCachedEntityRow(
  firmId: string,
  entity: CacheEntity,
  row: CacheRow,
  syncedAt: string,
  clientId?: QuickbooksClientScope,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const table = TABLE_BY_ENTITY[entity];
  // Firm-level rows carry client_id NULL; a specific client's rows carry its id.
  const clientValue = clientId ?? null;
  const run = async (useClientId: boolean): Promise<{ schemaMiss: boolean }> => {
    const onConflict = useClientId
      ? "firm_id,client_id,qbo_id"
      : "firm_id,qbo_id";
    const record = {
      firm_id: firmId,
      ...(useClientId ? { client_id: clientValue } : {}),
      qbo_id: row.id,
      name: row.name,
      active: row.active,
      ...(entity === "accounts"
        ? { account_type: row.accountType ?? null }
        : {}),
      ...(entity === "items"
        ? {
            item_type: row.itemType ?? null,
            income_account_qbo_id: row.incomeAccountId ?? null,
          }
        : {}),
      synced_at: syncedAt,
    };
    const { error } = await sb.from(table).upsert(record, { onConflict });
    if (error && isMissingSchema(error)) return { schemaMiss: true };
    if (error) throw error;
    return { schemaMiss: false };
  };

  // PRIMARY (post-0710): client-inclusive conflict target with client_id set.
  // FALLBACK (pre-0710): client_id column absent, so upsert firm-only. A missing
  // cache TABLE surfaces as schemaMiss in both passes → a clean no-op, mirroring
  // the rest of this module.
  const primary = await run(true);
  if (primary.schemaMiss) await run(false);
}

// Delete ALL of a firm's cached QuickBooks reference rows (all five entity
// tables). Used on disconnect and when the connected COMPANY changes: cached rows
// hold the old company's internal ids, and the next sync rebuilds everything from
// the newly connected company, so purging loses nothing durable. Service role;
// per-table best-effort (a missing table pre-migration is a no-op).
export async function purgeFirmQuickbooksCache(
  firmId: string,
  clientId?: QuickbooksClientScope,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  for (const table of Object.values(TABLE_BY_ENTITY)) {
    const base = () => sb.from(table).delete().eq("firm_id", firmId);
    const { error } = await runWithClientFallback(
      () => withClientScope(base(), clientId),
      () => base(),
    );
    if (error && !isMissingSchema(error)) {
      console.error(`[quickbooks] purge ${table} failed:`, error);
    }
  }
}
