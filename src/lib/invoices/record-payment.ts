// Record a payment that arrived outside the payment rails — a cheque, an
// Interac e-transfer, cash.
//
// THE DESIGN DECISION THAT MATTERS: this does not invent a second way for an
// invoice to become paid. It writes a ledger row, and when that row completes
// the bill it hands off to recordInvoicePaid — the exact function the Stripe
// webhook and the PayPal capture call. So a cheque and a card produce the same
// activity entry, the same frozen PDF, the same engagement stage move, the same
// firm notification, and the same closing of any still-open Stripe checkout.
// Nothing downstream needs to know how the money arrived.
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT DO: post anything to QuickBooks or Xero.
// The Phase 0 audit found that Vylan does not post invoice payments to either
// ledger by ANY route — the "payout journal" is a different feature entirely
// (it books a CLIENT's payment-processor statement into that client's books).
// Recording a cheque here is therefore exactly as truthful, and exactly as
// incomplete, as collecting the same money by card. Building a one-off journal
// path for manual payments only would make the two diverge, which is worse
// than both being absent.

import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  getPaymentRequestById,
  type PaymentRequest,
} from "@/lib/db/payment-requests";
import {
  insertInvoicePayment,
  MAX_PAYMENT_REFERENCE,
  type ManualPaymentMethod,
} from "@/lib/db/invoice-payments";
import { recordInvoicePaid } from "@/lib/payments/paid-event";
import { logUserActivity } from "@/lib/db/activity";
import { outstandingCents, isoDay } from "@/lib/invoices/outstanding";
import { cancelInvoiceChase } from "@/lib/invoices/chase";

export type RecordPaymentReason =
  | "unauthenticated"
  | "not_found"
  | "already_paid"
  | "voided"
  | "invalid_amount"
  | "invalid_date"
  | "migration_pending"
  | "save_failed";

export type RecordPaymentResult =
  | {
      ok: true;
      // True when this payment closed the invoice. False = a partial landed and
      // the balance is still owed, which the caller reports differently.
      settled: boolean;
      outstandingCents: number;
    }
  | { ok: false; reason: RecordPaymentReason };

export type RecordPaymentInput = {
  paymentRequestId: string;
  amountCents: number;
  method: ManualPaymentMethod;
  // ISO day. The date the money was RECEIVED, which is often not today.
  paidOn: string;
  reference?: string | null;
};

function isIsoDay(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export async function recordManualPayment(
  input: RecordPaymentInput,
  today: Date = new Date(),
): Promise<RecordPaymentResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, reason: "unauthenticated" };

  // RLS-scoped read, plus an explicit firm check as defence in depth.
  const invoice = await getPaymentRequestById(input.paymentRequestId);
  if (!invoice || invoice.firm_id !== firm.id) {
    return { ok: false, reason: "not_found" };
  }
  if (invoice.status === "canceled") return { ok: false, reason: "voided" };
  if (invoice.status === "paid") return { ok: false, reason: "already_paid" };

  if (!isIsoDay(input.paidOn)) return { ok: false, reason: "invalid_date" };
  // A payment cannot have been received in the future. Guarding this stops a
  // typo'd year from parking money outside every date-range report forever.
  if (input.paidOn > isoDay(today)) {
    return { ok: false, reason: "invalid_date" };
  }

  const owed = outstandingCents(invoice);
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    // Over-payment is refused rather than silently clamped: if the number is
    // wrong, the firm should see that, not have it quietly adjusted. Credit
    // notes are out of scope for v1, so there is nowhere for a surplus to go.
    input.amountCents > owed
  ) {
    return { ok: false, reason: "invalid_amount" };
  }

  const reference = input.reference?.trim()
    ? input.reference.trim().slice(0, MAX_PAYMENT_REFERENCE)
    : null;

  const row = await insertInvoicePayment({
    firmId: firm.id,
    paymentRequestId: invoice.id,
    clientId: invoice.client_id,
    engagementId: invoice.engagement_id,
    amountCents: input.amountCents,
    method: input.method,
    paidOn: input.paidOn,
    reference,
    recordedByUserId: user.id,
  });
  if (row === "migration_pending") {
    return { ok: false, reason: "migration_pending" };
  }
  if (!row) return { ok: false, reason: "save_failed" };

  // The database trigger has now updated amount_paid_cents. Re-read rather than
  // adding in JS: the re-read is what a concurrent second payment would also
  // see, so two people recording two halves at once still settle exactly once
  // (recordInvoicePaid's flip is first-writer-wins either way).
  const after = await getPaymentRequestById(invoice.id);
  const stillOwed = after
    ? outstandingCents(after)
    : Math.max(0, owed - input.amountCents);

  await logUserActivity(firm.id, invoice.engagement_id, "payment_recorded", {
    payment_request_id: invoice.id,
    payment_id: row.id,
    amount_cents: input.amountCents,
    currency: invoice.currency,
    method: input.method,
    paid_on: input.paidOn,
    reference,
    // Makes a partial legible in the feed without opening the invoice.
    outstanding_after_cents: stillOwed,
  });

  if (stillOwed > 0) {
    // Still owed: the invoice stays unpaid and keeps being chased. Nothing
    // else moves — no stage change, no client notification, no PDF freeze.
    return { ok: true, settled: false, outstandingCents: stillOwed };
  }

  // Fully covered — hand off to the ONE paid path, exactly as a rail would.
  await recordInvoicePaid(invoice.id, "manual");
  await cancelInvoiceChase(invoice.id);
  return { ok: true, settled: true, outstandingCents: 0 };
}

// Re-exported so callers don't need two imports to render an invoice's state.
export type { PaymentRequest };
