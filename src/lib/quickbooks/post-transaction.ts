// QuickBooks Stage 5 — building + validating the transaction we POST (pure).
//
// Posts EXPENSES as a QuickBooks "Bill" (records the expense against the vendor)
// and INCOME as an "Invoice" (a product/service item line).
//
// TAX HANDLING. When tax-line posting is enabled AND the document showed tax AND
// an active tax code was approved AND we can determine the pre-tax (net) amount,
// we post the NET amount on the line, attach the line's TaxCodeRef, and let
// QuickBooks COMPUTE the tax from that code's rate (option "a"). For non-US
// (Canadian) companies that means GlobalTaxCalculation = "TaxExcluded" (the field
// is non-US-only — see resolveTaxApplication). Otherwise (tax-lines off, no tax on
// the document, no code, or no derivable net) we fall back to posting the GROSS
// total on a single line with no tax code, exactly as before — so the change can
// never mis-state a transaction it doesn't have clean data for. Kept pure (no I/O)
// so it is unit-tested on its own.

import type { QuickbooksLists } from "./read";
import type { ResolvedRef } from "./suggest";

// How QuickBooks should interpret line amounts for tax (transaction-level). Only
// "TaxExcluded" is produced today (line amounts are net; QBO adds tax on top).
export type GlobalTaxCalculation =
  "TaxExcluded" | "TaxInclusive" | "NotApplicable";

// The resolved tax to apply to a posted transaction. `null` globalTaxCalculation
// means "omit the field" (US companies — their Automated Sales Tax engine computes
// from the line's tax code and the field is not valid for them).
export type TaxApplication = {
  taxCodeId: string;
  netAmount: number; // the pre-tax line amount QuickBooks adds tax onto
  globalTaxCalculation: GlobalTaxCalculation | null;
};

// Round a dollar amount to cents (QuickBooks rejects sub-cent precision).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// The pre-tax (net) line amount to post: prefer the extracted subtotal; otherwise
// derive it as total - tax (both extracted). Returns null when neither yields a
// positive net, so the caller falls back to the gross-no-tax path.
export function deriveNetAmount(
  subtotal: number | null,
  total: number | null,
  taxTotal: number | null,
): number | null {
  if (subtotal != null && subtotal > 0) return round2(subtotal);
  if (total != null && taxTotal != null) {
    const net = round2(total - taxTotal);
    if (net > 0) return net;
  }
  return null;
}

// A company is treated as US (so GlobalTaxCalculation is omitted) when its country
// is US or unknown. "GlobalTaxCalculation" is a non-US field; omitting it is the
// safe default when we don't yet know the country (the value is back-filled on
// connect/sync), and a Canadian connection always carries "CA" from connect time.
function isUsCompany(country: string | null): boolean {
  const c = (country ?? "").trim().toUpperCase();
  return c === "" || c === "US" || c === "USA" || c === "UNITED STATES";
}

// Decide whether (and how) to attach tax to a posted transaction. Returns null —
// post the gross total with no tax code — when tax-lines are off, the document
// had no tax, no tax code was approved, or we cannot determine a positive net.
export function resolveTaxApplication(input: {
  enabled: boolean;
  country: string | null;
  taxCodeId: string | null;
  subtotal: number | null;
  total: number | null;
  taxTotal: number | null;
}): TaxApplication | null {
  if (!input.enabled) return null;
  if (input.taxTotal == null) return null; // no tax on the document
  if (!input.taxCodeId) return null; // nothing to attach the tax to
  const net = deriveNetAmount(input.subtotal, input.total, input.taxTotal);
  if (net == null) return null;
  return {
    taxCodeId: input.taxCodeId,
    netAmount: net,
    globalTaxCalculation: isUsCompany(input.country) ? null : "TaxExcluded",
  };
}

// Cents of acceptable rounding drift between QuickBooks' computed tax and the tax
// printed on the document before we flag a discrepancy.
export const TAX_VARIANCE_TOLERANCE = 0.02;

// After posting with tax, compare what QuickBooks recorded against the document.
// Two checks: the GROSS TOTAL (catches a mis-read subtotal OR tax — the total is
// net + QBO-computed tax) and, as a fallback, the TAX itself. Returns a short
// human note when either differs beyond the tolerance (a wrong/combined code, a
// rate mismatch, or a bad extracted amount), else null. The total check is
// preferred because it's the most complete signal; the tax check covers the case
// where QuickBooks didn't return a total. Pure so it's unit-tested.
export function taxDiscrepancyNote(input: {
  computedTax: number | null;
  documentTax: number | null;
  computedTotal: number | null;
  documentTotal: number | null;
}): string | null {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const drifts = (a: number | null, b: number | null): boolean =>
    a != null && b != null && Math.abs(a - b) > TAX_VARIANCE_TOLERANCE;

  if (drifts(input.computedTotal, input.documentTotal)) {
    return (
      `QuickBooks recorded a total of ${money(input.computedTotal!)}, but the ` +
      `document showed ${money(input.documentTotal!)}. Check the amount and tax ` +
      `code in QuickBooks.`
    );
  }
  if (drifts(input.computedTax, input.documentTax)) {
    return (
      `QuickBooks calculated ${money(input.computedTax!)} of tax, but the ` +
      `document showed ${money(input.documentTax!)}. Check the tax code in ` +
      `QuickBooks.`
    );
  }
  return null;
}

export type BillInput = {
  vendorId: string;
  accountId: string;
  amount: number; // gross total — the fallback line amount when no tax is applied
  date: string | null; // ISO YYYY-MM-DD; omitted -> QBO uses today
  memo?: string | null;
  // When set, post the NET amount + the line's tax code and let QBO compute tax.
  tax?: TaxApplication | null;
};

// Build the minimal valid QuickBooks Bill body for one approved expense draft.
export function buildBillPayload(input: BillInput): Record<string, unknown> {
  const tax = input.tax ?? null;
  const lineAmount = round2(tax ? tax.netAmount : input.amount);
  const lineDetail: Record<string, unknown> = {
    AccountRef: { value: input.accountId },
  };
  if (tax) lineDetail.TaxCodeRef = { value: tax.taxCodeId };
  const bill: Record<string, unknown> = {
    VendorRef: { value: input.vendorId },
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: lineAmount,
        AccountBasedExpenseLineDetail: lineDetail,
      },
    ],
  };
  if (tax) {
    // Transaction-level tax code: MANDATORY to signal Automated-Sales-Tax intent
    // to QuickBooks. Without it an AST company (all modern QBO companies, incl.
    // Canada) returns error 6000 "encountered an error while calculating tax".
    // QBO then computes the tax from the line's TaxCodeRef.
    bill.TxnTaxDetail = { TxnTaxCodeRef: { value: tax.taxCodeId } };
    if (tax.globalTaxCalculation) {
      bill.GlobalTaxCalculation = tax.globalTaxCalculation;
    }
  }
  if (input.date) bill.TxnDate = input.date;
  if (input.memo) bill.PrivateNote = input.memo;
  return bill;
}

export type InvoiceInput = {
  customerId: string;
  itemId: string;
  amount: number; // gross total — the fallback line amount when no tax is applied
  date: string | null; // ISO YYYY-MM-DD; omitted -> QBO uses today
  memo?: string | null;
  // When set, post the NET amount + the line's tax code and let QBO compute tax.
  tax?: TaxApplication | null;
};

// Build the minimal valid QuickBooks Invoice body for one approved income draft.
// Income lines post to a product/service ITEM (SalesItemLineDetail), not an
// account; the tax code (when applied) rides on the same line detail.
export function buildInvoicePayload(
  input: InvoiceInput,
): Record<string, unknown> {
  const tax = input.tax ?? null;
  const lineAmount = round2(tax ? tax.netAmount : input.amount);
  const lineDetail: Record<string, unknown> = {
    ItemRef: { value: input.itemId },
  };
  if (tax) lineDetail.TaxCodeRef = { value: tax.taxCodeId };
  const invoice: Record<string, unknown> = {
    CustomerRef: { value: input.customerId },
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: lineAmount,
        SalesItemLineDetail: lineDetail,
      },
    ],
  };
  if (tax) {
    // Transaction-level tax code: MANDATORY to signal Automated-Sales-Tax intent
    // to QuickBooks. Without it an AST company (all modern QBO companies, incl.
    // Canada) returns error 6000 "encountered an error while calculating tax".
    // QBO then computes the tax from the line's TaxCodeRef.
    invoice.TxnTaxDetail = { TxnTaxCodeRef: { value: tax.taxCodeId } };
    if (tax.globalTaxCalculation) {
      invoice.GlobalTaxCalculation = tax.globalTaxCalculation;
    }
  }
  if (input.date) invoice.TxnDate = input.date;
  if (input.memo) invoice.PrivateNote = input.memo;
  return invoice;
}

// QuickBooks payment types we produce for a Purchase. Derived from the paid-from
// account's type so PaymentType and AccountRef never disagree.
export type QboPaymentType = "Cash" | "Check" | "CreditCard";

// A Credit Card account pays via "CreditCard"; a bank account via "Cash" (a safe,
// always-valid default for a bank Purchase). QuickBooks requires PaymentType to be
// consistent with the account, so we key it off the account's type.
export function paymentTypeForAccount(
  accountType: string | null,
): QboPaymentType {
  return (accountType ?? "").toLowerCase() === "credit card"
    ? "CreditCard"
    : "Cash";
}

export type PurchaseInput = {
  vendorId: string;
  accountId: string; // the expense (chart-of-accounts) category
  paymentAccountId: string; // the bank/credit-card account it was PAID FROM
  paymentType: QboPaymentType;
  amount: number; // gross total — the fallback line amount when no tax is applied
  date: string | null;
  memo?: string | null;
  tax?: TaxApplication | null;
};

// Build a QuickBooks "Purchase" (an already-paid expense) for one approved draft.
// Unlike a Bill (an unpaid payable), a Purchase records money already spent: it
// posts the expense line AND credits the bank/credit-card account it came from
// (AccountRef) with a PaymentType. Tax rides on the same line + transaction as the
// Bill/Invoice path.
export function buildPurchasePayload(
  input: PurchaseInput,
): Record<string, unknown> {
  const tax = input.tax ?? null;
  const lineAmount = round2(tax ? tax.netAmount : input.amount);
  const lineDetail: Record<string, unknown> = {
    AccountRef: { value: input.accountId },
  };
  if (tax) lineDetail.TaxCodeRef = { value: tax.taxCodeId };
  const purchase: Record<string, unknown> = {
    PaymentType: input.paymentType,
    AccountRef: { value: input.paymentAccountId }, // the account paid FROM
    EntityRef: { value: input.vendorId, type: "Vendor" },
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: lineAmount,
        AccountBasedExpenseLineDetail: lineDetail,
      },
    ],
  };
  if (tax) {
    purchase.TxnTaxDetail = { TxnTaxCodeRef: { value: tax.taxCodeId } };
    if (tax.globalTaxCalculation) {
      purchase.GlobalTaxCalculation = tax.globalTaxCalculation;
    }
  }
  if (input.date) purchase.TxnDate = input.date;
  if (input.memo) purchase.PrivateNote = input.memo;
  return purchase;
}

// Why a PAID-expense (Purchase) draft can't be posted. Empty array = postable.
export type PurchasePostabilityProblem =
  | "not_expense"
  | "missing_vendor"
  | "missing_account"
  | "missing_payment_account"
  | "missing_amount"
  | "vendor_inactive"
  | "account_inactive"
  | "payment_account_inactive";

// Pure server-side guard for a Purchase, re-checked at post time: an expense with
// an active vendor + active expense account + active paid-from account + positive
// amount. Active checks run only when the cached lists are available.
export function checkPurchasePostable(input: {
  direction: string;
  party: ResolvedRef | null;
  account: ResolvedRef | null;
  paymentAccount: ResolvedRef | null;
  amount: number | null;
  lists: QuickbooksLists | null;
}): PurchasePostabilityProblem[] {
  const problems: PurchasePostabilityProblem[] = [];
  if (input.direction !== "expense") problems.push("not_expense");
  if (!input.party) problems.push("missing_vendor");
  if (!input.account) problems.push("missing_account");
  if (!input.paymentAccount) problems.push("missing_payment_account");
  if (input.amount == null || !(input.amount > 0)) {
    problems.push("missing_amount");
  }
  const vendors = input.lists?.vendors;
  if (input.party && vendors) {
    const v = vendors.find((x) => x.id === input.party!.id);
    if (!v || !v.active) problems.push("vendor_inactive");
  }
  const accounts = input.lists?.accounts;
  if (accounts) {
    if (input.account) {
      const a = accounts.find((x) => x.id === input.account!.id);
      if (!a || !a.active) problems.push("account_inactive");
    }
    if (input.paymentAccount) {
      const pa = accounts.find((x) => x.id === input.paymentAccount!.id);
      if (!pa || !pa.active) problems.push("payment_account_inactive");
    }
  }
  return problems;
}

// Why an INCOME draft can't be posted. Empty array = postable.
export type InvoicePostabilityProblem =
  | "not_income"
  | "missing_customer"
  | "missing_item"
  | "missing_amount"
  | "customer_inactive"
  | "item_inactive";

// Pure server-side guard for income, re-checked at post time: an income draft
// with an active customer + active item + positive amount. Active checks run only
// when the cached lists are available (the live QuickBooks call is the backstop).
export function checkInvoicePostable(input: {
  direction: string;
  party: ResolvedRef | null; // the customer
  item: ResolvedRef | null;
  amount: number | null;
  lists: QuickbooksLists | null;
}): InvoicePostabilityProblem[] {
  const problems: InvoicePostabilityProblem[] = [];
  if (input.direction !== "income") problems.push("not_income");
  if (!input.party) problems.push("missing_customer");
  if (!input.item) problems.push("missing_item");
  if (input.amount == null || !(input.amount > 0)) {
    problems.push("missing_amount");
  }
  const customers = input.lists?.customers;
  if (input.party && customers) {
    const c = customers.find((x) => x.id === input.party!.id);
    if (!c || !c.active) problems.push("customer_inactive");
  }
  const items = input.lists?.items;
  if (input.item && items) {
    const it = items.find((x) => x.id === input.item!.id);
    if (!it || !it.active) problems.push("item_inactive");
  }
  return problems;
}

// Why a draft can't be posted (Phase 1). Empty array = postable.
export type PostabilityProblem =
  | "not_expense" // income/unknown — not supported in Phase 1
  | "missing_vendor"
  | "missing_account"
  | "missing_amount"
  | "vendor_inactive" // archived in QuickBooks since approval
  | "account_inactive";

// Pure server-side guard, re-checked at post time (never trust the approve-time
// state): the draft must be an expense with an active vendor + active account and
// a positive amount. Active checks run only when the cached lists are available;
// a missing list is not treated as "inactive" (the route still has the live
// QuickBooks validation as the backstop).
export function checkBillPostable(input: {
  direction: string;
  party: ResolvedRef | null;
  account: ResolvedRef | null;
  amount: number | null;
  lists: QuickbooksLists | null;
}): PostabilityProblem[] {
  const problems: PostabilityProblem[] = [];
  if (input.direction !== "expense") problems.push("not_expense");
  if (!input.party) problems.push("missing_vendor");
  if (!input.account) problems.push("missing_account");
  if (input.amount == null || !(input.amount > 0)) {
    problems.push("missing_amount");
  }
  const vendors = input.lists?.vendors;
  if (input.party && vendors) {
    const v = vendors.find((x) => x.id === input.party!.id);
    if (!v || !v.active) problems.push("vendor_inactive");
  }
  const accounts = input.lists?.accounts;
  if (input.account && accounts) {
    const a = accounts.find((x) => x.id === input.account!.id);
    if (!a || !a.active) problems.push("account_inactive");
  }
  return problems;
}
