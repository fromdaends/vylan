// QuickBooks reference-data cache — Stage 2, Phase 4 data layer.
//
// READS of the cached lists + sync state go through the AUTHENTICATED client so
// RLS scopes them to the firm (this data is non-secret; migration 0420 grants
// firm members SELECT). WRITES (the background sync job) go through the SERVICE
// role. Everything degrades gracefully (isMissingSchema) before 0420 is applied.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
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
export async function getFirmSyncState(): Promise<FirmSyncState | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("quickbooks_connections")
    .select("last_synced_at, sync_status, sync_error")
    .maybeSingle();
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
): Promise<QbItem[] | null> {
  let q = sb
    .from("quickbooks_items")
    .select("qbo_id, name, item_type, income_account_qbo_id, active");
  if (firmId) q = q.eq("firm_id", firmId);
  const { data, error } = await q;
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] readCachedItems failed:", error);
    }
    return null;
  }
  return (data ?? []).map(toCachedItem);
}

// Read the firm's cached lists (authenticated, RLS firm-scoped). Returns null
// when the cache tables don't exist yet (caller falls back to a live read).
export async function readCachedQuickbooksLists(): Promise<QuickbooksLists | null> {
  const sb = await getServerSupabase();
  const [acc, ven, cus, tax] = await Promise.all([
    sb.from("quickbooks_accounts").select("qbo_id, name, account_type, active"),
    sb.from("quickbooks_vendors").select("qbo_id, name, active"),
    sb.from("quickbooks_customers").select("qbo_id, name, active"),
    sb.from("quickbooks_tax_codes").select("qbo_id, name, active"),
  ]);
  for (const r of [acc, ven, cus, tax]) {
    if (r.error) {
      if (!isMissingSchema(r.error)) {
        console.error("[quickbooks] readCachedQuickbooksLists failed:", r.error);
      }
      return null;
    }
  }
  return {
    accounts: (acc.data ?? []).map(toCachedAccount),
    vendors: (ven.data ?? []).map(toCachedNamed),
    customers: (cus.data ?? []).map(toCachedNamed),
    taxCodes: (tax.data ?? []).map(toCachedNamed),
    items: await readCachedItems(sb),
  };
}

// Service-role read of a firm's cached lists BY firm id — for background workers
// (e.g. the classify worker generating a draft suggestion) that have no
// authenticated session, so RLS / current_firm_id() can't scope them. Mirrors
// readCachedQuickbooksLists but filters explicitly by firm_id. Returns null when
// the cache tables don't exist yet (pre-0420).
export async function readCachedQuickbooksListsForFirm(
  firmId: string,
): Promise<QuickbooksLists | null> {
  const sb = getServiceRoleSupabase();
  const [acc, ven, cus, tax] = await Promise.all([
    sb
      .from("quickbooks_accounts")
      .select("qbo_id, name, account_type, active")
      .eq("firm_id", firmId),
    sb.from("quickbooks_vendors").select("qbo_id, name, active").eq("firm_id", firmId),
    sb.from("quickbooks_customers").select("qbo_id, name, active").eq("firm_id", firmId),
    sb.from("quickbooks_tax_codes").select("qbo_id, name, active").eq("firm_id", firmId),
  ]);
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
    items: await readCachedItems(sb, firmId),
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
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const patch: Record<string, unknown> = {
    sync_status: input.status,
    sync_error: input.error ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.lastSyncedAt !== undefined) patch.last_synced_at = input.lastSyncedAt;
  const { error } = await sb
    .from("quickbooks_connections")
    .update(patch)
    .eq("firm_id", firmId);
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
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const table = TABLE_BY_ENTITY[entity];
  const records = rows.map((r) => ({
    firm_id: firmId,
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
    const { error } = await sb
      .from(table)
      .upsert(chunk, { onConflict: "firm_id,qbo_id" });
    if (error) throw error;
  }
  // Prune rows whose qbo_id vanished from QuickBooks since this sync started.
  const { error: delErr } = await sb
    .from(table)
    .delete()
    .eq("firm_id", firmId)
    .lt("synced_at", syncedAt);
  if (delErr) throw delErr;
}
