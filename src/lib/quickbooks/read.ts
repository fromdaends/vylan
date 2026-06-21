// QuickBooks read layer — Stage 2, READ-ONLY.
//
// Pulls reference lists from the connected QuickBooks company via the /query
// endpoint: Chart of Accounts, Vendors, Customers, Tax Codes. Everything here is
// read-only (no writes, no transactions) and runs server-side only — the tokens
// are service-role, so a browser can never call QuickBooks directly.
//
// Lists are read SEQUENTIALLY (not in parallel) and each large list is PAGED, to
// stay under QuickBooks' per-company rate limit (~500 reads/min, 429 on throttle,
// which we back off once and retry).

import {
  getQuickbooksReadContext,
  type QuickbooksReadContext,
} from "@/lib/quickbooks/connection";
import { quickbooksQuery, QuickbooksError } from "@/lib/quickbooks/client";

// One name + status, shared by vendors/customers/tax codes.
export type QbNamed = { id: string; name: string; active: boolean };
export type QbAccount = QbNamed & { accountType: string | null };

export type QuickbooksLists = {
  // null for a given list means "couldn't load this one" — the others still show.
  accounts: QbAccount[] | null;
  vendors: QbNamed[] | null;
  customers: QbNamed[] | null;
  taxCodes: QbNamed[] | null;
};

export type ReadListsResult =
  | { ok: true; data: QuickbooksLists }
  | { ok: false; reason: "not_connected" };

const PAGE_SIZE = 1000; // QBO's max page size for the /query endpoint.
const MAX_PAGES = 1000; // Safety cap (≈1M rows) so a bad response can't loop forever.
const RATE_LIMIT_RETRY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mappers: the raw QBO objects have dozens of fields; keep only what we show.

export function toAccount(r: {
  Id?: string;
  Name?: string;
  AccountType?: string;
  Active?: boolean;
}): QbAccount {
  return {
    id: String(r.Id ?? ""),
    name: (r.Name ?? "").trim(),
    accountType: r.AccountType ?? null,
    // QBO omits Active when true; treat anything but an explicit false as active.
    active: r.Active !== false,
  };
}

export function toVendor(r: {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
}): QbNamed {
  return {
    id: String(r.Id ?? ""),
    name: (r.DisplayName ?? r.CompanyName ?? "").trim(),
    active: r.Active !== false,
  };
}

export function toCustomer(r: {
  Id?: string;
  DisplayName?: string;
  Active?: boolean;
}): QbNamed {
  return {
    id: String(r.Id ?? ""),
    name: (r.DisplayName ?? "").trim(),
    active: r.Active !== false,
  };
}

export function toTaxCode(r: {
  Id?: string;
  Name?: string;
  Active?: boolean;
}): QbNamed {
  return {
    id: String(r.Id ?? ""),
    name: (r.Name ?? "").trim(),
    active: r.Active !== false,
  };
}

// One query with a single back-off+retry on a 429 (rate limit).
async function queryWithRetry(
  ctx: QuickbooksReadContext,
  sql: string,
): Promise<Record<string, unknown>> {
  try {
    return await quickbooksQuery(ctx.accessToken, ctx.realmId, sql, ctx.environment);
  } catch (e) {
    if (e instanceof QuickbooksError && e.status === 429) {
      await delay(RATE_LIMIT_RETRY_MS);
      return quickbooksQuery(ctx.accessToken, ctx.realmId, sql, ctx.environment);
    }
    throw e;
  }
}

// Read every page of an entity (STARTPOSITION / MAXRESULTS) and map each row.
// `WHERE Active IN (true, false)` is REQUIRED: QBO's /query endpoint returns ONLY
// active records by default, so without it archived/inactive accounts, vendors,
// etc. would silently never appear (and the inactive UI would be dead code).
async function readAll<R, T>(
  ctx: QuickbooksReadContext,
  entity: string,
  mapper: (r: R) => T,
): Promise<T[]> {
  const out: T[] = [];
  let start = 1;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sql =
      `SELECT * FROM ${entity} WHERE Active IN (true, false) ` +
      `STARTPOSITION ${start} MAXRESULTS ${PAGE_SIZE}`;
    const qr = await queryWithRetry(ctx, sql);
    const rows = (qr[entity] as R[] | undefined) ?? [];
    for (const r of rows) out.push(mapper(r));
    if (rows.length < PAGE_SIZE) return out; // short page => done
    start += PAGE_SIZE;
  }
  // Exited via the page cap with a still-full final page: the list was truncated.
  console.warn(
    `[quickbooks] ${entity} read hit the ${MAX_PAGES}-page cap (${out.length} rows); list may be truncated.`,
  );
  return out;
}

// Read one list, soft-failing to null so one bad list never sinks the others.
async function safeRead<R, T>(
  ctx: QuickbooksReadContext,
  entity: string,
  mapper: (r: R) => T,
): Promise<T[] | null> {
  try {
    return await readAll<R, T>(ctx, entity, mapper);
  } catch (e) {
    if (e instanceof QuickbooksError) {
      console.error(`[quickbooks] read ${entity} failed:`, e.code, e.message);
    } else {
      console.error(`[quickbooks] read ${entity} unexpected error:`, e);
    }
    return null;
  }
}

// Read the four reference lists for a firm's connected company. Sequential +
// paged + per-list soft failure. Returns not_connected when the firm has no live
// connection (or the token can't be refreshed).
export async function readQuickbooksLists(
  firmId: string,
): Promise<ReadListsResult> {
  const ctx = await getQuickbooksReadContext(firmId);
  if (!ctx) return { ok: false, reason: "not_connected" };
  const accounts = await safeRead(ctx, "Account", toAccount);
  const vendors = await safeRead(ctx, "Vendor", toVendor);
  const customers = await safeRead(ctx, "Customer", toCustomer);
  const taxCodes = await safeRead(ctx, "TaxCode", toTaxCode);
  return { ok: true, data: { accounts, vendors, customers, taxCodes } };
}
