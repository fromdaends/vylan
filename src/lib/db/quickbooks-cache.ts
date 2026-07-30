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
  isFirmLevelScope,
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
  QbTaxCode,
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
    clientId,
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
// 1050's direction columns. Selected separately from the basic set so a read can
// retry without them when the migration has not been applied — a missing column
// otherwise errors the query, and the callers turn ANY error into "no cached
// lists at all", which would strip every draft of its matches.
const TAX_COLS_RICH = "qbo_id, name, active, can_apply_to_revenue, can_apply_to_expenses";
const TAX_COLS_BASIC = "qbo_id, name, active";
// 1070's party currency, same treatment: a read must survive the column not
// existing yet, because every caller turns one query error into "no cached lists
// at all" and that would strip every draft of its matches.
const PARTY_COLS_RICH = "qbo_id, name, active, currency";
const PARTY_COLS_BASIC = "qbo_id, name, active";

function toCachedParty(r: Record<string, unknown>): QbNamed {
  const c = (r.currency as string | null)?.trim().toUpperCase();
  return {
    id: String(r.qbo_id ?? ""),
    name: (r.name as string | null) ?? "",
    active: r.active !== false,
    // Absent stays absent — the matcher only filters on a currency it knows.
    ...(c ? { currency: c } : {}),
  };
}

function toCachedTaxCode(r: Record<string, unknown>): QbTaxCode {
  return {
    id: String(r.qbo_id ?? ""),
    name: (r.name as string | null) ?? "",
    active: r.active !== false,
    // Absent (pre-1050 row, or a client not resynced since) means "no opinion" →
    // keep the code, so an un-resynced client sees every rate exactly as before
    // rather than an empty picker.
    canApplyToRevenue: r.can_apply_to_revenue !== false,
    canApplyToExpenses: r.can_apply_to_expenses !== false,
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
    clientId,
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
  // Reassigned to the basic set if 1050 turns out not to be applied.
  let taxCols = TAX_COLS_RICH;
  let partyCols = PARTY_COLS_RICH;
  const fetch = (scopeOn: boolean) => {
    const scope = <Q>(q: Q): Q => (scopeOn ? withClientScope(q, clientId) : q);
    return Promise.all([
      scope(
        sb
          .from("quickbooks_accounts")
          .select("qbo_id, name, account_type, active"),
      ),
      scope(sb.from("quickbooks_vendors").select(partyCols)),
      scope(sb.from("quickbooks_customers").select(partyCols)),
      scope(sb.from("quickbooks_tax_codes").select(taxCols)),
    ]);
  };
  // Always try the client-scoped read first; degrade to the no-filter read when
  // the client_id column isn't there yet (pre-0710) AND the scope is firm-level.
  // For a specific client the missing-schema error stays → return null (no cache
  // for that client yet), never the firm's rows.
  let [acc, ven, cus, tax] = await fetch(true);
  // 1050 not applied yet: the tax query alone failed on the two direction
  // columns. Retry with the basic set BEFORE the pre-0710 fallback, and keep the
  // client scope — a missing column must never cost the whole cache.
  if (
    (tax.error && isMissingSchema(tax.error)) ||
    (ven.error && isMissingSchema(ven.error)) ||
    (cus.error && isMissingSchema(cus.error))
  ) {
    if (tax.error) taxCols = TAX_COLS_BASIC;
    if (ven.error || cus.error) partyCols = PARTY_COLS_BASIC;
    [acc, ven, cus, tax] = await fetch(true);
  }
  if (
    isFirmLevelScope(clientId) &&
    [acc, ven, cus, tax].some((r) => r.error && isMissingSchema(r.error))
  ) {
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
    // Cast throughout: the select strings are chosen at runtime (rich vs basic),
    // which drops PostgREST's inferred row types.
    vendors: (
      (ven.data as unknown as Array<Record<string, unknown>> | null) ?? []
    ).map(toCachedParty),
    customers: (
      (cus.data as unknown as Array<Record<string, unknown>> | null) ?? []
    ).map(toCachedParty),
    taxCodes: (
      (tax.data as unknown as Array<Record<string, unknown>> | null) ?? []
    ).map(toCachedTaxCode),
    items: await readCachedItems(sb, undefined, clientId),
  };
}

// Read MANY clients' cached lists in one batched pass (authenticated, RLS
// firm-scoped) — for the firm-wide drafts queue, whose rows span clients. Five
// queries TOTAL (one per table, `.in(client_id, ...)`) instead of five per
// client, then grouped in memory. A client with no cached rows simply has no
// entry in the returned map. Specific-client scope throughout, so there is NO
// firm-level fallback (pre-0710 the client_id filter errors → empty map: no
// cache for those clients yet, never the firm's rows). Errors are logged and
// yield an EMPTY map — the queue renders with empty pickers, nothing breaks.
export async function readCachedQuickbooksListsByClient(
  clientIds: string[],
): Promise<Map<string, QuickbooksLists>> {
  // Concrete (non-null) arrays internally; the declared return widens to the
  // nullable-list QuickbooksLists shape.
  type Grouped = {
    accounts: QbAccount[];
    vendors: QbNamed[];
    customers: QbNamed[];
    taxCodes: QbNamed[];
    items: QbItem[];
  };
  const out = new Map<string, Grouped>();
  if (clientIds.length === 0) return out;
  const sb = await getServerSupabase();
  // eslint-disable-next-line prefer-const -- tax is reassigned by the 1050 retry
  let [acc, ven, cus, tax, items] = await Promise.all([
    sb
      .from("quickbooks_accounts")
      .select("client_id, qbo_id, name, account_type, active")
      .in("client_id", clientIds),
    sb
      .from("quickbooks_vendors")
      .select(`client_id, ${PARTY_COLS_RICH}`)
      .in("client_id", clientIds),
    sb
      .from("quickbooks_customers")
      .select(`client_id, ${PARTY_COLS_RICH}`)
      .in("client_id", clientIds),
    sb
      .from("quickbooks_tax_codes")
      .select(`client_id, ${TAX_COLS_RICH}`)
      .in("client_id", clientIds),
    // Items stay TOLERANT like readCachedItems: a missing table (pre-0460) or
    // error just means "no items" — it must never break the four core lists.
    sb
      .from("quickbooks_items")
      .select("client_id, qbo_id, name, item_type, income_account_qbo_id, active")
      .in("client_id", clientIds),
  ]);
  // 1050 not applied yet: re-read the tax codes without the direction columns.
  // Everything else already succeeded, and an error here would otherwise return
  // an empty map — stripping every row in the drafts queue of its cached lists.
  if (tax.error && isMissingSchema(tax.error)) {
    tax = (await sb
      .from("quickbooks_tax_codes")
      .select(`client_id, ${TAX_COLS_BASIC}`)
      .in("client_id", clientIds)) as typeof tax;
  }
  // Same for 1070's party currency.
  if (ven.error && isMissingSchema(ven.error)) {
    ven = (await sb
      .from("quickbooks_vendors")
      .select(`client_id, ${PARTY_COLS_BASIC}`)
      .in("client_id", clientIds)) as typeof ven;
  }
  if (cus.error && isMissingSchema(cus.error)) {
    cus = (await sb
      .from("quickbooks_customers")
      .select(`client_id, ${PARTY_COLS_BASIC}`)
      .in("client_id", clientIds)) as typeof cus;
  }
  for (const r of [acc, ven, cus, tax]) {
    if (r.error) {
      if (!isMissingSchema(r.error)) {
        console.error(
          "[quickbooks] readCachedQuickbooksListsByClient failed:",
          r.error,
        );
      }
      return out;
    }
  }
  const listsFor = (cid: string): Grouped => {
    let l = out.get(cid);
    if (!l) {
      l = { accounts: [], vendors: [], customers: [], taxCodes: [], items: [] };
      out.set(cid, l);
    }
    return l;
  };
  const groupInto = (
    rows: Array<Record<string, unknown>> | null,
    add: (l: Grouped, r: Record<string, unknown>) => void,
  ) => {
    for (const r of rows ?? []) {
      const cid = r.client_id as string | null;
      if (cid) add(listsFor(cid), r);
    }
  };
  groupInto(acc.data as Array<Record<string, unknown>> | null, (l, r) =>
    l.accounts.push(toCachedAccount(r)),
  );
  groupInto(ven.data as Array<Record<string, unknown>> | null, (l, r) =>
    l.vendors.push(toCachedParty(r)),
  );
  groupInto(cus.data as Array<Record<string, unknown>> | null, (l, r) =>
    l.customers.push(toCachedParty(r)),
  );
  groupInto(tax.data as Array<Record<string, unknown>> | null, (l, r) =>
    l.taxCodes.push(toCachedTaxCode(r)),
  );
  if (!items.error) {
    groupInto(items.data as Array<Record<string, unknown>> | null, (l, r) => {
      const item = toCachedItem(r);
      // Same non-sellable filter as readCachedItems (Category/Bundle rows are
      // rejected by QuickBooks on a transaction line).
      if (isSellableItem(item.itemType)) l.items.push(item);
    });
  }
  return out;
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
  // Reassigned to the basic set if 1050 turns out not to be applied.
  let firmTaxCols = TAX_COLS_RICH;
  let firmPartyCols = PARTY_COLS_RICH;
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
          .select(firmPartyCols)
          .eq("firm_id", firmId),
      ),
      scope(
        sb
          .from("quickbooks_customers")
          .select(firmPartyCols)
          .eq("firm_id", firmId),
      ),
      scope(
        sb.from("quickbooks_tax_codes").select(firmTaxCols).eq("firm_id", firmId),
      ),
    ]);
  };
  // Always try the client-scoped read first; degrade to the no-filter read when
  // the client_id column isn't there yet (pre-0710) AND the scope is firm-level.
  // For a specific client the missing-schema error stays → return null (no cache
  // for that client yet), never the firm's rows.
  let [acc, ven, cus, tax] = await fetch(true);
  // 1050 not applied yet: retry the same scope without the direction columns
  // before anything else, so a missing column never costs the whole cache.
  if (
    (tax.error && isMissingSchema(tax.error)) ||
    (ven.error && isMissingSchema(ven.error)) ||
    (cus.error && isMissingSchema(cus.error))
  ) {
    if (tax.error) firmTaxCols = TAX_COLS_BASIC;
    if (ven.error || cus.error) firmPartyCols = PARTY_COLS_BASIC;
    [acc, ven, cus, tax] = await fetch(true);
  }
  if (
    isFirmLevelScope(clientId) &&
    [acc, ven, cus, tax].some((r) => r.error && isMissingSchema(r.error))
  ) {
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
  // Cast because the tax select string is chosen at runtime (rich vs basic), which
  // drops PostgREST's inferred row types across the whole batch.
  const rows = (d: unknown) => (d as Array<Record<string, unknown>> | null) ?? [];
  return {
    accounts: rows(acc.data).map(toCachedAccount),
    vendors: rows(ven.data).map(toCachedParty),
    customers: rows(cus.data).map(toCachedParty),
    taxCodes: rows(tax.data).map(toCachedTaxCode),
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
    clientId,
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
  // Tax codes only (1050). Undefined = QuickBooks did not tell us, which every
  // reader treats as "no opinion, keep the code".
  canApplyToRevenue?: boolean;
  canApplyToExpenses?: boolean;
  // Vendors and customers only (1070) — the currency the party is denominated in.
  currency?: string;
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
  // `withTaxFlags` = include 1050's two direction columns. Retried without them
  // when the migration has not been applied yet, so a merge that lands before the
  // SQL is run degrades to today's behaviour instead of failing the whole sync.
  const run = async (
    useClientId: boolean,
    withTaxFlags = true,
  ): Promise<{ schemaMiss: boolean; taxFlagMiss: boolean }> => {
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
      ...(entity === "taxCodes" && withTaxFlags
        ? {
            can_apply_to_revenue: r.canApplyToRevenue ?? null,
            can_apply_to_expenses: r.canApplyToExpenses ?? null,
          }
        : {}),
      ...((entity === "vendors" || entity === "customers") && withTaxFlags
        ? { currency: r.currency ?? null }
        : {}),
      synced_at: syncedAt,
    }));
    // Upsert in chunks so a very large company can't exceed request limits.
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error } = await sb.from(table).upsert(chunk, { onConflict });
      if (error) {
        if (
          withTaxFlags &&
          (entity === "taxCodes" || entity === "vendors" || entity === "customers") &&
          isMissingSchema(error)
        ) {
          // 1050 or 1070 not applied: retry this entity without its extra column.
          return { schemaMiss: false, taxFlagMiss: true };
        }
        if (useClientId && isMissingSchema(error)) {
          return { schemaMiss: true, taxFlagMiss: false };
        }
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
      if (useClientId && isMissingSchema(delErr)) {
        return { schemaMiss: true, taxFlagMiss: false };
      }
      throw delErr;
    }
    return { schemaMiss: false, taxFlagMiss: false };
  };

  // PRIMARY (post-0710): always the client-inclusive pass. FALLBACK (pre-0710, the
  // client_id column is absent): replace firm-only — but ONLY for a firm-level
  // scope. For a specific client, skip the fallback (it would upsert/prune the
  // firm's rows); the primary already no-op'd on the missing column.
  let primary = await run(true);
  // 1050 not applied yet: same pass, without the two direction columns.
  if (primary.taxFlagMiss) primary = await run(true, false);
  if (primary.schemaMiss && isFirmLevelScope(clientId)) await run(false, false);
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
  // FALLBACK (pre-0710, client_id column absent): upsert firm-only — but ONLY for a
  // firm-level scope; for a specific client, skip it (it would write to the firm
  // row). A missing cache TABLE surfaces as schemaMiss and, for firm-level, the
  // fallback also no-ops on the missing table — mirroring the rest of this module.
  const primary = await run(true);
  if (primary.schemaMiss && isFirmLevelScope(clientId)) await run(false);
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
      clientId,
      () => withClientScope(base(), clientId),
      () => base(),
    );
    if (error && !isMissingSchema(error)) {
      console.error(`[quickbooks] purge ${table} failed:`, error);
    }
  }
}
