// The Billing list's filter vocabulary, and how money arrived.
//
// NEUTRAL MODULE — no "use client", and no import that reaches
// @/lib/supabase/server. That is the whole reason it exists separately from
// list.ts: the filter bar is a client component, and importing these constants
// from list.ts dragged the server Supabase client into the browser bundle. The
// build catches it ("Server Component imported in Client Component"), but only
// after everything else looks fine, so the rule is worth stating out loud:
//
//   values shared between server queries and client components live HERE.
//   list.ts may import this; this must never import list.ts.

export const INVOICE_PAGE_SIZE = 25;

// The filter values the UI offers. "all" is the absence of a filter, kept
// explicit so the query-string round-trip has something to say.
export const INVOICE_STATUS_FILTERS = [
  "all",
  "unpaid",
  "partly_paid",
  "overdue",
  "paid",
  "failed",
  "void",
] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export function isInvoiceStatusFilter(v: unknown): v is InvoiceStatusFilter {
  return (
    typeof v === "string" &&
    (INVOICE_STATUS_FILTERS as readonly string[]).includes(v)
  );
}

export type InvoiceListFilters = {
  status: InvoiceStatusFilter;
  clientId: string | null;
  // Inclusive ISO days against issue_date, falling back to created_at for rows
  // that predate native invoices and have no issue_date.
  from: string | null;
  to: string | null;
  search: string | null;
  page: number;
};

// How the money arrived. The two rails write their own rows at the paid flip;
// the rest are what a human recorded off a bank app or a cheque.
export type PaymentMethod =
  | "stripe"
  | "paypal"
  | "interac"
  | "cheque"
  | "cash"
  | "other";

// The ones a human can choose in the Record payment dialog. The rails are
// excluded on purpose: claiming a card payment by hand would put an invoice in
// a state no Stripe object backs.
export const MANUAL_PAYMENT_METHODS = [
  "interac",
  "cheque",
  "cash",
  "other",
] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export function isManualPaymentMethod(v: unknown): v is ManualPaymentMethod {
  return (
    typeof v === "string" &&
    (MANUAL_PAYMENT_METHODS as readonly string[]).includes(v)
  );
}

export const MAX_PAYMENT_REFERENCE = 300;
