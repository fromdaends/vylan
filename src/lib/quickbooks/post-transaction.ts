// QuickBooks Stage 5 — building + validating the transaction we POST (pure).
//
// Phase 1 posts EXPENSES ONLY, as a QuickBooks "Bill" (records the expense
// against the vendor; needs no bank/credit-card account). Income (SalesReceipt /
// Invoice) is deferred — it requires product/service "items" we don't sync yet.
//
// Phase 1 records the GROSS total as a single expense line with NO tax code
// (GlobalTaxCalculation is left to the company default). Splitting GST/QST onto
// the line is a deliberate later refinement, so the first write can never
// mis-state tax. Kept pure (no I/O) so it is unit-tested on its own.

import type { QuickbooksLists } from "./read";
import type { ResolvedRef } from "./suggest";

export type BillInput = {
  vendorId: string;
  accountId: string;
  amount: number;
  date: string | null; // ISO YYYY-MM-DD; omitted -> QBO uses today
  memo?: string | null;
};

// Build the minimal valid QuickBooks Bill body for one approved expense draft.
export function buildBillPayload(input: BillInput): Record<string, unknown> {
  const amount = Math.round(input.amount * 100) / 100;
  const bill: Record<string, unknown> = {
    VendorRef: { value: input.vendorId },
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: amount,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: input.accountId },
        },
      },
    ],
  };
  if (input.date) bill.TxnDate = input.date;
  if (input.memo) bill.PrivateNote = input.memo;
  return bill;
}

export type InvoiceInput = {
  customerId: string;
  itemId: string;
  amount: number;
  date: string | null; // ISO YYYY-MM-DD; omitted -> QBO uses today
  memo?: string | null;
};

// Build the minimal valid QuickBooks Invoice body for one approved income draft.
// Income lines post to a product/service ITEM (SalesItemLineDetail), not an
// account. Like the Bill path, Phase 1 posts the GROSS total on a single line
// with no tax code (tax handling is a later refinement).
export function buildInvoicePayload(input: InvoiceInput): Record<string, unknown> {
  const amount = Math.round(input.amount * 100) / 100;
  const invoice: Record<string, unknown> = {
    CustomerRef: { value: input.customerId },
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: amount,
        SalesItemLineDetail: {
          ItemRef: { value: input.itemId },
        },
      },
    ],
  };
  if (input.date) invoice.TxnDate = input.date;
  if (input.memo) invoice.PrivateNote = input.memo;
  return invoice;
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
