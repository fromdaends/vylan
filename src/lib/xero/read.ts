// Xero read layer + adapter — Phase 2 (READ-ONLY).
//
// Live-reads a client's Xero organisation reference lists and maps them onto the
// SHARED QuickbooksLists shape so the existing matcher (lib/quickbooks/suggest.ts)
// works unchanged. The mapping is the load-bearing part:
//   * Xero has ONE unified Contact list → split into vendors / customers by
//     IsSupplier / IsCustomer. A contact that is BOTH, or NEITHER yet (Xero only
//     sets the flags after a transaction), goes in BOTH lists — otherwise a
//     brand-new contact would silently never match.
//   * Xero account Type/Class → the 'Expense' / 'Income' / 'Bank' / 'Credit Card'
//     strings the matcher's type predicates substring/exact-match. A wrong
//     mapping here fails SILENTLY (empty candidate pools, no error), so it's
//     pure + unit-tested.

import {
  fetchXeroAccounts,
  fetchXeroContactsAll,
  fetchXeroTaxRates,
  fetchXeroItems,
  XeroError,
  type XeroRawAccount,
  type XeroRawContact,
  type XeroRawTaxRate,
  type XeroRawItem,
} from "@/lib/xero/client";
import { getXeroReadContext } from "@/lib/xero/connection";
import type {
  QuickbooksLists,
  QbAccount,
  QbNamed,
  QbItem,
} from "@/lib/quickbooks/read";

// The cache-row shapes the sync writes + the cached read produces. Kept here so
// both the live mapper and the cache adapter share one normalization.
export type XeroAccountRow = {
  xeroId: string;
  code: string | null;
  name: string;
  accountType: string | null; // NORMALIZED (see normalizeXeroAccountType)
  active: boolean;
};
export type XeroContactRow = {
  xeroId: string;
  name: string;
  isSupplier: boolean;
  isCustomer: boolean;
  active: boolean;
};
export type XeroTaxRateRow = {
  xeroId: string;
  name: string;
  active: boolean;
};
export type XeroItemRow = {
  xeroId: string;
  code: string | null;
  name: string;
  incomeAccountCode: string | null;
  active: boolean;
};

// Map a Xero account's Type / BankAccountType / Class to the accountType STRING
// the shared matcher expects:
//   * isPaymentAccountType() exact-matches (lowercased) 'bank' | 'credit card'
//   * isExpenseType() substring-matches 'expense' | 'cost of goods'
//   * isIncomeType() substring-matches 'income' | 'revenue'
// Anything else passes through the raw Type (won't match a predicate — correct
// for assets/liabilities/equity, which aren't pickable as expense/income/paid-from).
export function normalizeXeroAccountType(
  type: string | null | undefined,
  bankAccountType: string | null | undefined,
  cls: string | null | undefined,
): string | null {
  const t = (type ?? "").toUpperCase();
  const bat = (bankAccountType ?? "").toUpperCase();
  const c = (cls ?? "").toUpperCase();
  if (t === "BANK") {
    // Credit-card accounts are paid-from too, but must read exactly "Credit Card".
    return bat === "CREDITCARD" ? "Credit Card" : "Bank";
  }
  if (t === "DIRECTCOSTS") return "Cost of Goods Sold";
  if (t === "EXPENSE" || t === "OVERHEADS" || c === "EXPENSE") return "Expense";
  if (t === "REVENUE" || t === "SALES" || c === "REVENUE") return "Income";
  // Assets / liabilities / equity / current / fixed / prepayment / etc.
  return type ?? null;
}

export function toXeroAccountRow(r: XeroRawAccount): XeroAccountRow {
  return {
    xeroId: String(r.AccountID ?? ""),
    code: r.Code?.trim() || null,
    name: (r.Name ?? "").trim(),
    accountType: normalizeXeroAccountType(r.Type, r.BankAccountType, r.Class),
    active: (r.Status ?? "ACTIVE").toUpperCase() !== "ARCHIVED",
  };
}
export function toXeroContactRow(r: XeroRawContact): XeroContactRow {
  return {
    xeroId: String(r.ContactID ?? ""),
    name: (r.Name ?? "").trim(),
    isSupplier: r.IsSupplier === true,
    isCustomer: r.IsCustomer === true,
    active: (r.ContactStatus ?? "ACTIVE").toUpperCase() === "ACTIVE",
  };
}
export function toXeroTaxRateRow(r: XeroRawTaxRate): XeroTaxRateRow {
  return {
    xeroId: String(r.TaxType ?? ""),
    name: (r.Name ?? "").trim(),
    // DELETED/ARCHIVED tax rates can't be used on new lines; PENDING/ACTIVE can.
    active: ["ACTIVE", "PENDING"].includes((r.Status ?? "ACTIVE").toUpperCase()),
  };
}
export function toXeroItemRow(r: XeroRawItem): XeroItemRow {
  return {
    xeroId: String(r.ItemID ?? ""),
    code: r.Code?.trim() || null,
    name: (r.Name ?? r.Code ?? "").trim(),
    incomeAccountCode: r.SalesDetails?.AccountCode?.trim() || null,
    active: true, // Xero returns only live items (no Status field)
  };
}

// Adapt normalized Xero rows to the shared QuickbooksLists. The `id`s are the
// Xero identifiers a later posting phase uses (AccountID / ContactID / TaxType /
// ItemID). A contact with NEITHER flag set (never transacted) is treated as
// both a potential vendor AND customer so the matcher can still find it.
export function xeroRowsToLists(input: {
  accounts: XeroAccountRow[] | null;
  contacts: XeroContactRow[] | null;
  taxRates: XeroTaxRateRow[] | null;
  items: XeroItemRow[] | null;
}): QuickbooksLists {
  const accounts: QbAccount[] | null = input.accounts
    ? input.accounts.map((a) => ({
        id: a.xeroId,
        name: a.name,
        accountType: a.accountType,
        active: a.active,
      }))
    : null;
  const asNamed = (c: XeroContactRow): QbNamed => ({
    id: c.xeroId,
    name: c.name,
    active: c.active,
  });
  const vendors: QbNamed[] | null = input.contacts
    ? input.contacts.filter((c) => c.isSupplier || !c.isCustomer).map(asNamed)
    : null;
  const customers: QbNamed[] | null = input.contacts
    ? input.contacts.filter((c) => c.isCustomer || !c.isSupplier).map(asNamed)
    : null;
  const taxCodes: QbNamed[] | null = input.taxRates
    ? input.taxRates.map((t) => ({ id: t.xeroId, name: t.name, active: t.active }))
    : null;
  const items: QbItem[] | null = input.items
    ? input.items.map((i) => ({
        id: i.xeroId,
        name: i.name,
        // Xero items have no QBO-style type; the matcher's isSellableItem treats
        // a null type as sellable (Xero items are products/services, never QBO
        // Category/Bundle groupings). incomeAccountId bridges income → item, but
        // Xero items reference the income account by CODE, so we surface the code.
        itemType: null,
        incomeAccountId: i.incomeAccountCode,
        active: i.active,
      }))
    : null;
  return { accounts, vendors, customers, taxCodes, items };
}

export type ReadXeroListsResult =
  | { ok: true; data: QuickbooksLists }
  | { ok: false; reason: "not_connected" };

// Live-read a client's Xero reference lists into the shared shape. Each list
// soft-fails to null (one bad list doesn't sink the others), mirroring the QBO
// reader. Sequential to stay well under Xero's 60-calls/min/tenant limit.
export async function readXeroLists(
  firmId: string,
  clientId: string,
): Promise<ReadXeroListsResult> {
  const ctx = await getXeroReadContext(firmId, clientId);
  if (!ctx) return { ok: false, reason: "not_connected" };

  async function safe<R>(fn: () => Promise<R[]>, label: string): Promise<R[] | null> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof XeroError) {
        console.error(`[xero] read ${label} failed:`, e.code, e.message);
      } else {
        console.error(`[xero] read ${label} unexpected error:`, e);
      }
      return null;
    }
  }

  const accountsRaw = await safe(
    () => fetchXeroAccounts(ctx.accessToken, ctx.tenantId),
    "Accounts",
  );
  const contactsRaw = await safe(
    () => fetchXeroContactsAll(ctx.accessToken, ctx.tenantId),
    "Contacts",
  );
  const taxRaw = await safe(
    () => fetchXeroTaxRates(ctx.accessToken, ctx.tenantId),
    "TaxRates",
  );
  const itemsRaw = await safe(
    () => fetchXeroItems(ctx.accessToken, ctx.tenantId),
    "Items",
  );

  return {
    ok: true,
    data: xeroRowsToLists({
      accounts: accountsRaw ? accountsRaw.map(toXeroAccountRow) : null,
      contacts: contactsRaw ? contactsRaw.map(toXeroContactRow) : null,
      taxRates: taxRaw ? taxRaw.map(toXeroTaxRateRow) : null,
      items: itemsRaw ? itemsRaw.map(toXeroItemRow) : null,
    }),
  };
}

// The normalized rows a live read produced, for the sync to write to the cache.
// (readXeroLists returns the adapted lists for display; the sync needs the row
// shape with is_supplier/is_customer/code preserved.)
export type XeroReadRows = {
  accounts: XeroAccountRow[] | null;
  contacts: XeroContactRow[] | null;
  taxRates: XeroTaxRateRow[] | null;
  items: XeroItemRow[] | null;
};

export async function readXeroRows(
  firmId: string,
  clientId: string,
): Promise<{ ok: true; rows: XeroReadRows } | { ok: false; reason: "not_connected" }> {
  const ctx = await getXeroReadContext(firmId, clientId);
  if (!ctx) return { ok: false, reason: "not_connected" };
  async function safe<R>(fn: () => Promise<R[]>, label: string): Promise<R[] | null> {
    try {
      return await fn();
    } catch (e) {
      console.error(
        `[xero] read ${label} failed:`,
        e instanceof XeroError ? `${e.code} ${e.message}` : e,
      );
      return null;
    }
  }
  const accountsRaw = await safe(() => fetchXeroAccounts(ctx.accessToken, ctx.tenantId), "Accounts");
  const contactsRaw = await safe(() => fetchXeroContactsAll(ctx.accessToken, ctx.tenantId), "Contacts");
  const taxRaw = await safe(() => fetchXeroTaxRates(ctx.accessToken, ctx.tenantId), "TaxRates");
  const itemsRaw = await safe(() => fetchXeroItems(ctx.accessToken, ctx.tenantId), "Items");
  return {
    ok: true,
    rows: {
      accounts: accountsRaw ? accountsRaw.map(toXeroAccountRow) : null,
      contacts: contactsRaw ? contactsRaw.map(toXeroContactRow) : null,
      taxRates: taxRaw ? taxRaw.map(toXeroTaxRateRow) : null,
      items: itemsRaw ? itemsRaw.map(toXeroItemRow) : null,
    },
  };
}
