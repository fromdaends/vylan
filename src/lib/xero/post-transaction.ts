// Xero Phase 4 (posting) — building the transaction bodies we POST (pure, no I/O).
//
// Mirrors the QuickBooks builders (lib/quickbooks/post-transaction.ts) but emits
// Xero's shapes. A receipt/invoice draft posts as one of four Xero transactions:
//
//   Bill (unpaid expense)   -> POST /Invoices        Type=ACCPAY  (account lines)
//   Spend (paid expense)    -> POST /BankTransactions Type=SPEND  (account lines + BankAccount)
//   Invoice (unpaid income) -> POST /Invoices        Type=ACCREC  (item/account line)
//   Receive (paid income)   -> POST /BankTransactions Type=RECEIVE (item/account line + BankAccount)
//
// XERO IDENTIFIERS (verified against the cache schema + developer.xero.com):
//   - Contact       -> Contact.ContactID  (the ContactID GUID = our party.id)
//   - Line account  -> LineItem.AccountCode (the account CODE string, NOT the GUID)
//   - Line tax      -> LineItem.TaxType (the tax rate's TaxType = our taxCode.id)
//   - Line item     -> LineItem.ItemCode (the item CODE string, NOT the ItemID GUID)
//   - Bank account  -> BankAccount.AccountID (GUID; bank accounts often have no code)
// So the ORCHESTRATION layer resolves each picked account/item GUID -> its code
// before calling these builders; tax + contact + bank ids are used directly.
//
// TAX. Xero always COMPUTES tax from the line's TaxType — you never send a tax
// amount (and on BankTransactions tax is not overridable at all). When the
// document showed tax AND a TaxType was approved AND we can derive the net, we set
// LineAmountTypes="Exclusive" and put the NET on the line + its TaxType, and Xero
// adds the tax. Otherwise we post the GROSS on a single line with
// LineAmountTypes="NoTax". LineAmountTypes is ALWAYS set explicitly — Xero's
// per-endpoint defaults differ (Invoices=Exclusive, BankTransactions=Inclusive),
// so relying on the default would silently mis-state a transaction.

// How a bill/invoice lands in Xero — what Hubdoc calls "Publish as":
//   DRAFT      -> Xero "Draft"             (nothing owed yet; edit it in Xero)
//   SUBMITTED  -> Xero "Awaiting approval"  (an approval workflow picks it up)
//   AUTHORISED -> Xero "Awaiting payment"   (live and payable — our default)
//
// Bank transactions (SPEND/RECEIVE) have NO equivalent: a cash movement is not
// an approvable payable, and Xero's BankTransaction.Status only accepts
// AUTHORISED or DELETED. The spend builder therefore takes no status at all.
export type XeroInvoiceStatus = "DRAFT" | "SUBMITTED" | "AUTHORISED";

// Does this status need a DueDate? Xero requires one on an ACCPAY that is, or
// is about to become, authorised — and a SUBMITTED bill is one approval click
// away, so it needs one too. Only a true DRAFT may go without.
export function xeroStatusNeedsDueDate(status: XeroInvoiceStatus): boolean {
  return status === "AUTHORISED" || status === "SUBMITTED";
}

// Undoing a post: which Xero status change actually retracts a transaction.
//
// THIS IS WHY posted_status IS STORED. Xero REJECTS the VOIDED transition on a
// DRAFT or SUBMITTED invoice — the legal move there is DELETED. Re-deriving the
// status from the draft's current state instead of what was really sent would
// throw on undo, leave the bill sitting in the client's books, and strand the
// row as "posted" in Vylan.
//
// null = posted before we recorded it, which was always AUTHORISED.
export function xeroUndoStatusFor(
  postedStatus: XeroInvoiceStatus | null,
): "VOIDED" | "DELETED" {
  return postedStatus === "DRAFT" || postedStatus === "SUBMITTED"
    ? "DELETED"
    : "VOIDED";
}

// LineAmountTypes (transaction-level). "Exclusive": line amounts are net, Xero
// adds tax from each line's TaxType. "NoTax": no tax anywhere (gross line, no
// TaxType). ("Inclusive" is never produced — we always post net-exclusive.)
export type XeroLineAmountTypes = "Exclusive" | "Inclusive" | "NoTax";

// The resolved tax to apply: the line's TaxType + the pre-tax (net) amount Xero
// adds the tax onto.
export type XeroTaxApplication = { taxType: string; netAmount: number };

// Should the posted transaction carry an explicit CurrencyCode?
//
// Xero books a transaction in the ORGANISATION's currency unless told
// otherwise. A CAD invoice posted into a USD organisation without this became
// 6,720 USD — the right number against the wrong currency, which no later
// reconciliation catches because the figure looks correct.
//
// Sent ONLY when the two genuinely differ. Sending it needlessly means Xero
// rejects the post unless that currency is enabled on the organisation, so an
// unknown base currency (a connection made before we recorded it) deliberately
// sends nothing and keeps today's behaviour rather than guessing.
export function xeroCurrencyCodeFor(
  documentCurrency: string | null | undefined,
  organisationCurrency: string | null | undefined,
): string | null {
  const doc = documentCurrency?.trim().toUpperCase();
  const org = organisationCurrency?.trim().toUpperCase();
  if (!doc || !org) return null;
  return doc === org ? null : doc;
}

// Round a dollar amount to cents.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// The pre-tax (net) line amount to post: prefer the extracted subtotal; otherwise
// derive it as total - tax. Returns null when neither yields a positive net, so
// the caller falls back to the gross-no-tax path. (Identical rule to QuickBooks.)
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

// Decide whether (and how) to attach tax. Returns null — post the gross total with
// LineAmountTypes="NoTax" — when tax-lines are off, the document had no tax, no
// TaxType was approved, or we cannot determine a positive net.
export function resolveXeroTaxApplication(input: {
  enabled: boolean;
  taxType: string | null; // the tax rate's TaxType (= approved taxCode.id)
  subtotal: number | null;
  total: number | null;
  taxTotal: number | null;
}): XeroTaxApplication | null {
  if (!input.enabled) return null;
  if (input.taxTotal == null) return null; // no tax on the document
  if (!input.taxType) return null; // nothing to attach the tax to
  const net = deriveNetAmount(input.subtotal, input.total, input.taxTotal);
  if (net == null) return null;
  return { taxType: input.taxType, netAmount: net };
}

// One posted expense line: an amount against a chart-of-accounts CODE. A
// single-line post has one; a SPLIT post has several (each its own account code).
export type XeroExpenseLine = { amount: number; accountCode: string };

// The effective expense lines: the multi-line SPLIT override when given (each
// line's amount is PRE-TAX), else one line for the whole net (taxed) / gross
// amount. Splitting is only valid WITH tax (line amounts are pre-tax and rely on
// Xero adding tax to reach the gross) — the caller gates this; this is the
// matching safety net so the builder can never silently drop the tax.
function resolveExpenseLines(
  singleAccountCode: string,
  singleAmount: number,
  tax: XeroTaxApplication | null,
  lines: XeroExpenseLine[] | undefined,
): XeroExpenseLine[] {
  if (tax && lines && lines.length > 0) return lines;
  return [
    {
      amount: tax ? tax.netAmount : singleAmount,
      accountCode: singleAccountCode,
    },
  ];
}

// Build the Xero account-based LineItem[] shared by Bill + Spend. The (shared)
// TaxType rides on every line when tax applies.
function buildAccountLineItems(
  lines: XeroExpenseLine[],
  tax: XeroTaxApplication | null,
  description: string,
): Record<string, unknown>[] {
  return lines.map((l) => {
    const li: Record<string, unknown> = {
      Description: description,
      Quantity: 1,
      UnitAmount: round2(l.amount),
      AccountCode: l.accountCode,
    };
    if (tax) li.TaxType = tax.taxType;
    return li;
  });
}

// Build the single income LineItem (Invoice/Receive). Prefers ItemCode (Xero maps
// it to the item's sales account); also sets AccountCode when known so the line is
// valid even for an item with no code. At least one of the two must be present
// (the caller's postability check guarantees it).
function buildIncomeLineItem(input: {
  itemCode: string | null;
  accountCode: string | null;
  amount: number;
  tax: XeroTaxApplication | null;
  description: string;
}): Record<string, unknown> {
  const li: Record<string, unknown> = {
    Description: input.description,
    Quantity: 1,
    UnitAmount: round2(input.tax ? input.tax.netAmount : input.amount),
  };
  if (input.itemCode) li.ItemCode = input.itemCode;
  if (input.accountCode) li.AccountCode = input.accountCode;
  if (input.tax) li.TaxType = input.tax.taxType;
  return li;
}

const DEFAULT_LINE_DESCRIPTION = "Posted from Vylan";

// Xero's Reference field caps at 255 characters.
//
// NOT the shared postingReference() from lib/quickbooks/suggest.ts — that caps
// at 21 because that is QuickBooks' DocNumber limit, which would shred a uuid
// and throw away the traceability this whole function exists to provide.
const XERO_REFERENCE_MAX = 255;

// What goes in the posted transaction's Reference.
//
// A document with no invoice number used to post with NO reference at all,
// leaving nothing in Xero tying the transaction back to the paper in Vylan.
// Hubdoc solves this by always writing something ("HD - <document id>"); this
// is ours, using the uploaded file's full id so pasting it into Vylan lands on
// the exact document. Deterministic, so an undo-then-repost writes the same
// value.
//
// ONLY FOR INVOICES (ACCPAY/ACCREC) IN V1 — deliberate. Xero's bank
// reconciliation "Find & Match" reads Reference, so on a BankTransaction
// (SPEND/RECEIVE) a high-entropy VYL- token is a live change to how those
// firms reconcile: today a blank reference lets Xero match on payee + amount +
// date. Amount and date dominate that match, so this is unlikely to break it —
// but "unlikely" is not something to discover in a client's books, and no unit
// test can see it. The `kind` parameter is here so widening to bank
// transactions after a real reconciliation walkthrough is one line, not a
// refactor.
export function xeroPostingReference(
  documentReference: string | null | undefined,
  uploadedFileId: string,
  kind: "invoice" | "banktransaction",
): string | null {
  const trimmed = documentReference?.trim();
  if (trimmed) return trimmed.slice(0, XERO_REFERENCE_MAX);
  if (kind === "banktransaction") return null;
  return `VYL-${uploadedFileId}`.slice(0, XERO_REFERENCE_MAX);
}

// ── Bill (ACCPAY): an unpaid expense payable ────────────────────────────────
export type XeroBillInput = {
  contactId: string;
  accountCode: string;
  amount: number; // gross total — the fallback line amount when no tax applies
  date: string; // ISO YYYY-MM-DD
  dueDate?: string | null;
  reference?: string | null;
  description?: string | null;
  tax?: XeroTaxApplication | null;
  lines?: XeroExpenseLine[]; // SPLIT (≥1); each carries its pre-tax amount + code
  status?: XeroInvoiceStatus;
  // Set only when the document's currency differs from the organisation's.
  currencyCode?: string | null;
};

export function buildXeroBillPayload(
  input: XeroBillInput,
): Record<string, unknown> {
  const tax = input.tax ?? null;
  const lineList = resolveExpenseLines(
    input.accountCode,
    input.amount,
    tax,
    input.lines,
  );
  const status = input.status ?? "AUTHORISED";
  const body: Record<string, unknown> = {
    Type: "ACCPAY",
    Contact: { ContactID: input.contactId },
    LineAmountTypes: tax ? "Exclusive" : "NoTax",
    LineItems: buildAccountLineItems(
      lineList,
      tax,
      input.description || DEFAULT_LINE_DESCRIPTION,
    ),
    Date: input.date,
    Status: status,
  };
  // An AUTHORISED (or soon-to-be-authorised SUBMITTED) ACCPAY requires a
  // DueDate; default it to the transaction date when the document didn't give
  // one (a valid, conservative "due now").
  if (xeroStatusNeedsDueDate(status)) body.DueDate = input.dueDate || input.date;
  else if (input.dueDate) body.DueDate = input.dueDate;
  if (input.reference) body.Reference = input.reference;
  if (input.currencyCode) body.CurrencyCode = input.currencyCode;
  return body;
}

// ── Spend (SPEND): a paid expense, against a bank/credit-card account ────────
export type XeroSpendInput = {
  contactId: string;
  accountCode: string;
  bankAccountId: string; // the bank/CC account's AccountID (GUID) it was paid from
  amount: number;
  date: string;
  reference?: string | null;
  description?: string | null;
  tax?: XeroTaxApplication | null;
  lines?: XeroExpenseLine[];
  // Set only when the document's currency differs from the organisation's.
  currencyCode?: string | null;
};

export function buildXeroSpendPayload(
  input: XeroSpendInput,
): Record<string, unknown> {
  const tax = input.tax ?? null;
  const lineList = resolveExpenseLines(
    input.accountCode,
    input.amount,
    tax,
    input.lines,
  );
  const body: Record<string, unknown> = {
    Type: "SPEND",
    Contact: { ContactID: input.contactId },
    BankAccount: { AccountID: input.bankAccountId },
    LineAmountTypes: tax ? "Exclusive" : "NoTax",
    LineItems: buildAccountLineItems(
      lineList,
      tax,
      input.description || DEFAULT_LINE_DESCRIPTION,
    ),
    Date: input.date,
  };
  if (input.reference) body.Reference = input.reference;
  if (input.currencyCode) body.CurrencyCode = input.currencyCode;
  return body;
}

// ── Invoice (ACCREC): unpaid income the customer owes ───────────────────────
export type XeroIncomeInput = {
  contactId: string;
  itemCode: string | null;
  accountCode: string | null; // income account (item bridge) fallback
  amount: number;
  date: string;
  dueDate?: string | null;
  reference?: string | null;
  description?: string | null;
  tax?: XeroTaxApplication | null;
  status?: XeroInvoiceStatus;
  // Set only when the document's currency differs from the organisation's.
  currencyCode?: string | null;
};

export function buildXeroInvoicePayload(
  input: XeroIncomeInput,
): Record<string, unknown> {
  const tax = input.tax ?? null;
  const status = input.status ?? "AUTHORISED";
  const body: Record<string, unknown> = {
    Type: "ACCREC",
    Contact: { ContactID: input.contactId },
    LineAmountTypes: tax ? "Exclusive" : "NoTax",
    LineItems: [
      buildIncomeLineItem({
        itemCode: input.itemCode,
        accountCode: input.accountCode,
        amount: input.amount,
        tax,
        description: input.description || DEFAULT_LINE_DESCRIPTION,
      }),
    ],
    Date: input.date,
    Status: status,
  };
  if (xeroStatusNeedsDueDate(status)) body.DueDate = input.dueDate || input.date;
  else if (input.dueDate) body.DueDate = input.dueDate;
  if (input.reference) body.Reference = input.reference;
  if (input.currencyCode) body.CurrencyCode = input.currencyCode;
  return body;
}

// ── Receive (RECEIVE): paid income, deposited to a bank account ──────────────
export type XeroReceiveInput = {
  contactId: string;
  itemCode: string | null;
  accountCode: string | null;
  bankAccountId: string;
  amount: number;
  date: string;
  reference?: string | null;
  description?: string | null;
  tax?: XeroTaxApplication | null;
  // Set only when the document's currency differs from the organisation's.
  currencyCode?: string | null;
};

export function buildXeroReceivePayload(
  input: XeroReceiveInput,
): Record<string, unknown> {
  const tax = input.tax ?? null;
  const body: Record<string, unknown> = {
    Type: "RECEIVE",
    Contact: { ContactID: input.contactId },
    BankAccount: { AccountID: input.bankAccountId },
    LineAmountTypes: tax ? "Exclusive" : "NoTax",
    LineItems: [
      buildIncomeLineItem({
        itemCode: input.itemCode,
        accountCode: input.accountCode,
        amount: input.amount,
        tax,
        description: input.description || DEFAULT_LINE_DESCRIPTION,
      }),
    ],
    Date: input.date,
  };
  if (input.reference) body.Reference = input.reference;
  if (input.currencyCode) body.CurrencyCode = input.currencyCode;
  return body;
}

// Cents of acceptable rounding drift between Xero's computed tax and the tax
// printed on the document before we flag a discrepancy. (Matches QuickBooks.)
export const XERO_TAX_VARIANCE_TOLERANCE = 0.02;

// After posting with tax, compare what Xero recorded (Total / TotalTax on the
// response) against the document. Returns a short human note when either differs
// beyond tolerance, else null. Pure so it's unit-tested.
export function xeroTaxDiscrepancyNote(input: {
  computedTax: number | null;
  documentTax: number | null;
  computedTotal: number | null;
  documentTotal: number | null;
}): string | null {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const drifts = (a: number | null, b: number | null): boolean =>
    a != null && b != null && Math.abs(a - b) > XERO_TAX_VARIANCE_TOLERANCE;

  if (drifts(input.computedTotal, input.documentTotal)) {
    return (
      `Xero recorded a total of ${money(input.computedTotal!)}, but the ` +
      `document showed ${money(input.documentTotal!)}. Check the amount and tax ` +
      `rate in Xero.`
    );
  }
  if (drifts(input.computedTax, input.documentTax)) {
    return (
      `Xero calculated ${money(input.computedTax!)} of tax, but the document ` +
      `showed ${money(input.documentTax!)}. Check the tax rate in Xero.`
    );
  }
  return null;
}
