// Xero reference-data cache (migration 0780) — per client.
//
// READS produce the SHARED QuickbooksLists shape (via xeroRowsToLists) so the
// existing matcher works unchanged; authenticated reads are RLS firm-scoped, the
// service-role read is for the background worker. WRITES (the sync job) are
// service-role. Per-client from day one → no legacy fallbacks (contrast
// db/quickbooks-cache.ts). Everything degrades gracefully (isMissingXeroSchema)
// before 0780 is applied.

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { isMissingXeroSchema } from "@/lib/db/xero";
import {
  xeroRowsToLists,
  type XeroAccountRow,
  type XeroContactRow,
  type XeroTaxRateRow,
  type XeroItemRow,
  type XeroReadRows,
} from "@/lib/xero/read";
import type { QuickbooksLists } from "@/lib/quickbooks/read";

// A supabase client seen only as "give me a table" — enough to build reads
// without dragging in PostgREST's deeply-recursive builder generics (which trip
// tsc's instantiation-depth limit).
type MinimalSb = { from: (table: string) => MinimalBuilder };
type QueryResult = {
  data: Array<Record<string, unknown>> | null;
  error: { code?: string; message?: string } | null;
};
type MinimalQuery = {
  eq: (col: string, val: unknown) => MinimalQuery;
} & PromiseLike<QueryResult>;
type MinimalBuilder = { select: (cols: string) => MinimalQuery };

// Shared cache read: read one client's four cached tables into the typed row
// arrays (still carrying code / income_account_code, which the QuickbooksLists
// shape drops). `firmId` adds an explicit filter for the service-role path (RLS
// can't scope it); the authed path passes null and relies on RLS. Returns null
// pre-0780 / on error.
async function readRowsWith(
  sbRaw: unknown,
  clientId: string,
  firmId: string | null,
): Promise<XeroReadRows | null> {
  const sb = sbRaw as MinimalSb;
  const read = (table: string, cols: string): MinimalQuery => {
    let q = sb.from(table).select(cols).eq("client_id", clientId);
    if (firmId) q = q.eq("firm_id", firmId);
    return q;
  };
  const [acc, con, tax, items] = await Promise.all([
    read("xero_accounts", "xero_id, code, name, account_type, active"),
    read("xero_contacts", "xero_id, name, is_supplier, is_customer, active"),
    read("xero_tax_rates", "xero_id, name, active"),
    read("xero_items", "xero_id, code, name, income_account_code, active"),
  ]);
  for (const r of [acc, con, tax, items]) {
    if (r.error) {
      if (!isMissingXeroSchema(r.error)) {
        console.error("[xero] readCachedXeroLists failed:", r.error);
      }
      return null;
    }
  }
  const accounts: XeroAccountRow[] = (
    (acc.data as Array<Record<string, unknown>> | null) ?? []
  ).map((r) => ({
    xeroId: String(r.xero_id ?? ""),
    code: (r.code as string | null) ?? null,
    name: (r.name as string | null) ?? "",
    accountType: (r.account_type as string | null) ?? null,
    active: r.active !== false,
  }));
  const contacts: XeroContactRow[] = (
    (con.data as Array<Record<string, unknown>> | null) ?? []
  ).map((r) => ({
    xeroId: String(r.xero_id ?? ""),
    name: (r.name as string | null) ?? "",
    isSupplier: r.is_supplier === true,
    isCustomer: r.is_customer === true,
    active: r.active !== false,
  }));
  const taxRates: XeroTaxRateRow[] = (
    (tax.data as Array<Record<string, unknown>> | null) ?? []
  ).map((r) => ({
    xeroId: String(r.xero_id ?? ""),
    name: (r.name as string | null) ?? "",
    active: r.active !== false,
  }));
  const itemRows: XeroItemRow[] = (
    (items.data as Array<Record<string, unknown>> | null) ?? []
  ).map((r) => ({
    xeroId: String(r.xero_id ?? ""),
    code: (r.code as string | null) ?? null,
    name: (r.name as string | null) ?? "",
    incomeAccountCode: (r.income_account_code as string | null) ?? null,
    active: r.active !== false,
  }));
  return { accounts, contacts, taxRates, items: itemRows };
}

// Shared cache read adapted to the QuickbooksLists shape the matcher/pickers use.
async function readListsWith(
  sbRaw: unknown,
  clientId: string,
  firmId: string | null,
): Promise<QuickbooksLists | null> {
  const rows = await readRowsWith(sbRaw, clientId, firmId);
  return rows ? xeroRowsToLists(rows) : null;
}

// Everything the POSTING orchestration needs for one client, in one read: the
// QuickbooksLists (for the provider-neutral postability/active checks) PLUS the
// GUID→code maps the matcher shape drops but Xero line items require — line
// account = AccountCode, item = ItemCode, and an item's income AccountCode as the
// fallback when it has no code. (Contact/tax/bank use their ids directly, so no
// map is needed for those.) Service-role (posting knows firm + client). Null
// pre-0780 / on error.
export async function readXeroPostingContext(
  firmId: string,
  clientId: string,
): Promise<{
  lists: QuickbooksLists;
  accountCodeById: Map<string, string | null>;
  itemCodeById: Map<string, string | null>;
  itemIncomeAccountCodeById: Map<string, string | null>;
} | null> {
  const sb = getServiceRoleSupabase();
  const rows = await readRowsWith(sb, clientId, firmId);
  if (!rows) return null;
  const accounts = rows.accounts ?? [];
  const items = rows.items ?? [];
  return {
    lists: xeroRowsToLists(rows),
    accountCodeById: new Map(accounts.map((a) => [a.xeroId, a.code])),
    itemCodeById: new Map(items.map((i) => [i.xeroId, i.code])),
    itemIncomeAccountCodeById: new Map(
      items.map((i) => [i.xeroId, i.incomeAccountCode]),
    ),
  };
}

// Authenticated (RLS firm-scoped) read for a page render. Null pre-0780 / on error.
export async function readCachedXeroLists(
  clientId: string,
): Promise<QuickbooksLists | null> {
  const sb = await getServerSupabase();
  return readListsWith(sb, clientId, null);
}

// Service-role read BY firm id — for the background classify worker (no authed
// session, so RLS can't scope it). Explicit firm_id filter.
export async function readCachedXeroListsForFirm(
  firmId: string,
  clientId: string,
): Promise<QuickbooksLists | null> {
  const sb = getServiceRoleSupabase();
  return readListsWith(sb, clientId, firmId);
}

// ── Writers (the sync job, service-role) ─────────────────────────────────────

export type XeroSyncStatus = "idle" | "syncing" | "ok" | "error";

export async function setXeroSyncState(
  firmId: string,
  clientId: string,
  input: { status: XeroSyncStatus; error?: string | null; lastSyncedAt?: string | null },
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const patch: Record<string, unknown> = {
    sync_status: input.status,
    sync_error: input.error ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.lastSyncedAt !== undefined) patch.last_synced_at = input.lastSyncedAt;
  const { error } = await sb
    .from("xero_connections")
    .update(patch)
    .eq("firm_id", firmId)
    .eq("client_id", clientId);
  if (error && !isMissingXeroSchema(error)) {
    console.error("[xero] setXeroSyncState failed:", error);
  }
}

const TABLE_BY_ENTITY = {
  accounts: "xero_accounts",
  contacts: "xero_contacts",
  taxRates: "xero_tax_rates",
  items: "xero_items",
} as const;
export type XeroCacheEntity = keyof typeof TABLE_BY_ENTITY;

type AnyRow = XeroAccountRow | XeroContactRow | XeroTaxRateRow | XeroItemRow;

// Column record for a normalized row of the given entity.
function recordFor(
  entity: XeroCacheEntity,
  firmId: string,
  clientId: string,
  row: AnyRow,
  syncedAt: string,
): Record<string, unknown> {
  const base = {
    firm_id: firmId,
    client_id: clientId,
    xero_id: row.xeroId,
    name: row.name,
    active: row.active,
    synced_at: syncedAt,
  };
  if (entity === "accounts") {
    const a = row as XeroAccountRow;
    return { ...base, code: a.code, account_type: a.accountType };
  }
  if (entity === "contacts") {
    const c = row as XeroContactRow;
    return { ...base, is_supplier: c.isSupplier, is_customer: c.isCustomer };
  }
  if (entity === "items") {
    const i = row as XeroItemRow;
    return { ...base, code: i.code, income_account_code: i.incomeAccountCode };
  }
  return base; // taxRates
}

// Replace a client's cached rows for one entity: upsert fresh rows (stamped with
// `syncedAt`), then prune any row of this (firm, client) NOT refreshed this sync
// (removed from Xero). Upsert-then-prune avoids a momentarily-empty list; the
// upsert is idempotent on (firm_id, client_id, xero_id). Service role.
export async function replaceCachedXeroEntity(
  firmId: string,
  clientId: string,
  entity: XeroCacheEntity,
  rows: AnyRow[],
  syncedAt: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const table = TABLE_BY_ENTITY[entity];
  const records = rows
    .filter((r) => r.xeroId) // never cache a row without an id
    .map((r) => recordFor(entity, firmId, clientId, r, syncedAt));
  for (let i = 0; i < records.length; i += 500) {
    const { error } = await sb
      .from(table)
      .upsert(records.slice(i, i + 500), {
        onConflict: "firm_id,client_id,xero_id",
      });
    if (error) throw error;
  }
  const { error: delErr } = await sb
    .from(table)
    .delete()
    .eq("firm_id", firmId)
    .eq("client_id", clientId)
    .lt("synced_at", syncedAt);
  if (delErr) throw delErr;
}

// Delete ALL of a client's cached Xero rows (all four tables) — on disconnect or
// when the connected org changes. Per-table best-effort (a missing table
// pre-0780 is a no-op).
export async function purgeXeroCache(
  firmId: string,
  clientId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  for (const table of Object.values(TABLE_BY_ENTITY)) {
    const { error } = await sb
      .from(table)
      .delete()
      .eq("firm_id", firmId)
      .eq("client_id", clientId);
    if (error && !isMissingXeroSchema(error)) {
      console.error(`[xero] purge ${table} failed:`, error);
    }
  }
}

// Re-export for the sync module (which writes each read list per entity).
export type { XeroReadRows };
