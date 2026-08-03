// What is still owed on an invoice, and what to call its state.
//
// Pure and dependency-free — imported by server queries, server components and
// client components alike, so the number in the stat strip, the number in the
// table row and the number in the Record-payment dialog are the same number by
// construction rather than by three people agreeing. (Neutral module on
// purpose: a constant exported from a "use client" file reads as a stub in a
// Server Component.)
//
// ⚠ THE ONE RULE THAT IS NOT ARITHMETIC. Every invoice paid before migration
// 1260 has status 'paid' and amount_paid_cents = 0, because the payment ledger
// did not exist to record it. So outstanding is NOT amount_cents -
// amount_paid_cents. It is:
//
//     status is paid or void  ->  0
//     otherwise               ->  amount_cents - amount_paid_cents
//
// Getting this backwards would report every historical invoice as fully
// outstanding and put a fictional five-figure number on the Billing header.

export type StoredInvoiceStatus =
  | "requested"
  | "paid"
  | "failed"
  | "canceled";

// What the firm sees. Derived on read — none of these are stored, so an invoice
// becomes overdue by the clock moving, with nothing to keep in sync.
export type InvoiceDisplayStatus =
  | "unpaid"
  | "partly_paid"
  | "overdue"
  | "paid"
  | "failed"
  | "void";

export type InvoiceStateInput = {
  status: StoredInvoiceStatus;
  amount_cents: number;
  // Undefined on a pre-1260 read (the column is dropped by the tiered select
  // when the migration hasn't been applied) — treated as nothing paid, which
  // is the pre-1260 truth.
  amount_paid_cents?: number | null;
  due_date?: string | null;
};

export function amountPaidCents(inv: InvoiceStateInput): number {
  const paid = inv.amount_paid_cents;
  return typeof paid === "number" && paid > 0 ? paid : 0;
}

export function outstandingCents(inv: InvoiceStateInput): number {
  // A void invoice is owed nothing; a paid one is settled whether or not the
  // ledger knows the details (see the note above).
  if (inv.status === "paid" || inv.status === "canceled") return 0;
  const rest = inv.amount_cents - amountPaidCents(inv);
  // Never negative: an over-payment recorded by hand (a client rounds up) is
  // still "nothing owed", not a credit. Credit notes are explicitly out of v1.
  return rest > 0 ? rest : 0;
}

// Past its due date and still owed. `today` is injected so callers on the
// server and in tests agree on the day; the default reads the clock.
export function isOverdue(
  inv: InvoiceStateInput,
  today: Date = new Date(),
): boolean {
  if (!inv.due_date) return false;
  if (outstandingCents(inv) === 0) return false;
  if (inv.status === "paid" || inv.status === "canceled") return false;
  // due_date is a DATE column ("2026-08-31"): an invoice due today is not yet
  // overdue, it becomes overdue when the day after it begins. Comparing the
  // ISO day strings keeps this off the timezone rocks entirely — no Date
  // parsing, so no "due at midnight UTC is already yesterday in Vancouver".
  return isoDay(today) > inv.due_date;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function invoiceDisplayStatus(
  inv: InvoiceStateInput,
  today: Date = new Date(),
): InvoiceDisplayStatus {
  if (inv.status === "canceled") return "void";
  if (inv.status === "paid") return "paid";
  // A failed card attempt still leaves the money owed, so it can also be
  // overdue — and overdue is the more actionable of the two.
  if (isOverdue(inv, today)) return "overdue";
  if (inv.status === "failed") return "failed";
  if (amountPaidCents(inv) > 0) return "partly_paid";
  return "unpaid";
}

// Does this invoice still want chasing? The reminder worker asks this on every
// fire rather than trusting the queue, so paying an invoice stops the cadence
// even though the queued jobs are still sitting there.
export function isChaseable(
  inv: InvoiceStateInput & { auto_chase?: boolean | null },
): boolean {
  if (inv.auto_chase === false) return false;
  if (inv.status === "paid" || inv.status === "canceled") return false;
  return outstandingCents(inv) > 0;
}
