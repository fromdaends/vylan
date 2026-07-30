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
export type QbNamed = {
  id: string;
  name: string;
  active: boolean;
  // QUICKBOOKS ONLY: the currency this supplier/customer is DENOMINATED in.
  //
  // In QuickBooks a party carries a currency and a transaction cannot depart
  // from it — posting a USD bill to a CAD supplier is refused outright ("you can
  // only use one foreign currency per transaction"), and the currency is fixed
  // when the party is created. Xero has no equivalent: there a contact is
  // currency-neutral and the transaction states its own.
  //
  // Optional, and undefined means "we do not know" — never "home currency".
  // Nothing filters on an unknown value, so a client not yet resynced keeps
  // matching exactly as before.
  currency?: string;
};
export type QbAccount = QbNamed & { accountType: string | null };
// A tax code, plus (XERO ONLY) which side of the books it may be used on. Xero
// publishes CanApplyToRevenue / CanApplyToExpenses on every rate; QuickBooks has
// no equivalent, so both are OPTIONAL and `undefined` means "no opinion, keep
// it" — that is what preserves QuickBooks' behaviour untouched.
export type QbTaxCode = QbNamed & {
  canApplyToRevenue?: boolean;
  canApplyToExpenses?: boolean;
};
// A product/service Item. itemType = QBO Type (Service/NonInventory/…);
// incomeAccountId = the item's income account (so a draft mapped to an income
// account can be matched to its item). Used for income posting (Invoice lines
// reference an Item, not an account).
export type QbItem = QbNamed & {
  itemType: string | null;
  incomeAccountId: string | null;
};

export type QuickbooksLists = {
  // null for a given list means "couldn't load this one" — the others still show.
  accounts: QbAccount[] | null;
  vendors: QbNamed[] | null;
  customers: QbNamed[] | null;
  taxCodes: QbTaxCode[] | null;
  // Optional + added later (0460): older readers/constructors omit it. null =
  // couldn't load / not synced yet.
  items?: QbItem[] | null;
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

// A party's currency, or nothing at all when QuickBooks did not say. Spread into
// the object so the key is ABSENT rather than explicitly undefined — the
// difference matters to the matcher, which only filters on a known value.
function currencyOf(ref: { value?: string } | undefined): { currency?: string } {
  const c = ref?.value?.trim().toUpperCase();
  return c ? { currency: c } : {};
}

export function toVendor(r: {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
  CurrencyRef?: { value?: string };
}): QbNamed {
  return {
    id: String(r.Id ?? ""),
    name: (r.DisplayName ?? r.CompanyName ?? "").trim(),
    active: r.Active !== false,
    ...currencyOf(r.CurrencyRef),
  };
}

export function toCustomer(r: {
  Id?: string;
  DisplayName?: string;
  Active?: boolean;
  CurrencyRef?: { value?: string };
}): QbNamed {
  return {
    id: String(r.Id ?? ""),
    name: (r.DisplayName ?? "").trim(),
    active: r.Active !== false,
    ...currencyOf(r.CurrencyRef),
  };
}

// Does one of QuickBooks' two rate lists actually contain a rate?
//
// The shape is { TaxRateDetail: [ { TaxRateRef, … }, … ] }. Returns undefined when
// the field is ABSENT or in a shape we do not recognise — never false. That
// distinction matters: undefined means "no opinion" and the matcher keeps the
// code, whereas false EXCLUDES it. Guessing false on an unfamiliar payload would
// silently empty a client's tax picker, which is far worse than not filtering.
function listHasRates(list: unknown): boolean | undefined {
  if (list == null || typeof list !== "object") return undefined;
  const detail = (list as { TaxRateDetail?: unknown }).TaxRateDetail;
  if (!Array.isArray(detail)) return undefined;
  return detail.length > 0;
}

export function toTaxCode(r: {
  Id?: string;
  Name?: string;
  Active?: boolean;
  // QuickBooks states usability per DIRECTION as two lists of rates, rather than
  // as Xero's two booleans. A code is usable on sales when its sales list has
  // rates and on purchases when its purchase list does.
  SalesTaxRateList?: unknown;
  PurchaseTaxRateList?: unknown;
}): QbTaxCode {
  const revenue = listHasRates(r.SalesTaxRateList);
  const expenses = listHasRates(r.PurchaseTaxRateList);
  return {
    id: String(r.Id ?? ""),
    name: (r.Name ?? "").trim(),
    active: r.Active !== false,
    // Only set when QuickBooks actually told us; absent stays absent so the
    // matcher keeps its "no opinion" behaviour.
    ...(revenue === undefined ? {} : { canApplyToRevenue: revenue }),
    ...(expenses === undefined ? {} : { canApplyToExpenses: expenses }),
  };
}

export function toItem(r: {
  Id?: string;
  Name?: string;
  FullyQualifiedName?: string;
  Type?: string;
  Active?: boolean;
  IncomeAccountRef?: { value?: string };
}): QbItem {
  return {
    id: String(r.Id ?? ""),
    // Sub-items read as "Parent:Child" via FullyQualifiedName when present.
    name: (r.FullyQualifiedName ?? r.Name ?? "").trim(),
    itemType: r.Type ?? null,
    incomeAccountId: r.IncomeAccountRef?.value ?? null,
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
  clientId?: string | null,
): Promise<ReadListsResult> {
  const ctx = await getQuickbooksReadContext(firmId, clientId);
  if (!ctx) return { ok: false, reason: "not_connected" };
  const accounts = await safeRead(ctx, "Account", toAccount);
  const vendors = await safeRead(ctx, "Vendor", toVendor);
  const customers = await safeRead(ctx, "Customer", toCustomer);
  const taxCodes = await safeRead(ctx, "TaxCode", toTaxCode);
  const items = await safeRead(ctx, "Item", toItem);
  return { ok: true, data: { accounts, vendors, customers, taxCodes, items } };
}

// Has this client's reference cache actually been populated yet?
//
// The cache readers return zero rows as EMPTY ARRAYS, not null, so a
// `if (cached)` guard passes with nothing in it and a draft gets built that
// matches nothing — every field amber, reading to the accountant as "the AI
// failed" when the truth is "we had no lists to match against yet". That is
// exactly what happens in the window after a disconnect/reconnect (disconnect
// purges the cache) or before a new client's first sync job runs.
//
// ACCOUNTS is the signal, not contacts: every accounting organisation has a
// chart of accounts from the day it is created, whereas a genuinely new client
// can legitimately have zero contacts and zero items. So no accounts means the
// sync has not landed, not that the books are empty.
export function listsAreSynced(
  lists: QuickbooksLists | null,
): lists is QuickbooksLists {
  if (!lists) return false;
  return (lists.accounts?.length ?? 0) > 0;
}
