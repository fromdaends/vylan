// The ONE "invoice paid" (and "payment failed") event, whatever rail collected
// the money. Every path that settles an invoice funnels through here:
//
//   * the Stripe Connect webhook (checkout.session.completed /
//     payment_intent.payment_failed),
//   * the Stripe self-heal reconcile (lib/payments/reconcile.ts),
//   * the PayPal capture + webhook paths (Phases 3-4).
//
// It does exactly what the Stripe webhook historically did inline: atomically
// flip the payment_request, write the activity entry, and re-sync the
// engagement stage — so the invoice lock, stage, and history behave
// IDENTICALLY regardless of provider. Idempotent end to end: the flip is a
// conditional first-writer-wins update (lib/db/payment-requests.ts), so a
// replayed webhook, a reconcile racing a webhook, or (with two rails) a second
// provider landing on an already-paid invoice all no-op here.

import {
  markPaymentRequestPaidSR,
  markPaymentRequestFailedSR,
  type PaidProvider,
} from "@/lib/db/payment-requests";
import { logServiceRoleActivity } from "@/lib/db/activity";
import { syncEngagementStageSR } from "@/lib/engagements/stage-sync";
import { expireOpenStripeCheckout } from "@/lib/payments/close-other-rail";
import { freezeInvoicePdfSR } from "@/lib/invoices/pdf-data";

// Provider references stored on the invoice at settle time (each rail fills its
// own pair; the other rail's stay untouched).
export type InvoicePaidRefs = {
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  paypalOrderId?: string | null;
  paypalCaptureId?: string | null;
};

export type RecordInvoicePaidResult =
  // newly_paid = THIS call flipped it (activity logged, stage synced).
  // already_settled = someone else won the race / a replay — nothing recorded.
  | { outcome: "newly_paid" }
  | { outcome: "already_settled" };

export async function recordInvoicePaid(
  paymentRequestId: string,
  provider: PaidProvider,
  refs: InvoicePaidRefs = {},
  opts: {
    // The reconcile path runs while RENDERING accountant/portal pages and has
    // never synced the stage there (the stage catches up on the next stage
    // event or webhook). Pass false to preserve exactly that behavior; every
    // webhook/capture path leaves the default true.
    syncStage?: boolean;
  } = {},
): Promise<RecordInvoicePaidResult> {
  const result = await markPaymentRequestPaidSR(paymentRequestId, {
    ...refs,
    provider,
  });
  if (!result) return { outcome: "already_settled" };

  // Cross-rail closeout: PayPal just settled this invoice, but a Stripe
  // Checkout session created earlier may still be OPEN and able to take a
  // card. Expire it (best-effort — the atomic flip above already makes a
  // second charge unrecordable; this closes the door on the client paying at
  // all). Stripe-paid invoices need nothing: uncaptured PayPal orders are
  // inert.
  if (provider === "paypal" && result.stripeCheckoutSessionId) {
    await expireOpenStripeCheckout(
      result.firmId,
      result.stripeCheckoutSessionId,
    ).catch(() => {});
  }

  await logServiceRoleActivity(
    result.firmId,
    result.engagementId,
    "client_paid",
    {
      amount_cents: result.amountCents,
      currency: result.currency,
      payment_request_id: paymentRequestId,
      provider,
    },
  );
  // Paid = immutable: freeze the generated invoice's PDF as the permanent
  // record (survives later firm-identity changes). Best-effort and internally
  // try/caught — a render/storage failure never touches the payment, and the
  // on-demand path re-renders the now-locked row identically. No-ops for
  // simple/attached invoices.
  await freezeInvoicePdfSR(paymentRequestId);

  // Payment lands: the engagement leaves awaiting_payment. It becomes
  // "completed" only if the finished work is actually out with the client —
  // otherwise it settles back on in_preparation until the deliverables are
  // released. Paying also lifts the deliverables lock, so a locked-and-now-paid
  // engagement reads completed in one step. (engagement_id is nullable — a
  // payment need not belong to an engagement.)
  if (opts.syncStage !== false && result.engagementId) {
    await syncEngagementStageSR(result.engagementId);
  }
  return { outcome: "newly_paid" };
}

// A payment attempt failed (async card failure today; PayPal capture denied in
// Phase 4). Never overwrites paid — a failed attempt on an already-settled
// invoice records nothing.
export async function recordInvoiceFailed(
  paymentRequestId: string,
  provider: PaidProvider,
): Promise<void> {
  const result = await markPaymentRequestFailedSR(paymentRequestId);
  if (!result) return;
  await logServiceRoleActivity(
    result.firmId,
    result.engagementId,
    "payment_failed",
    { payment_request_id: paymentRequestId, provider },
  );
  // A failed invoice is still owed, so this rarely moves the stage — but it can
  // re-apply the deliverables lock a moment of optimism had lifted, which pulls
  // a "completed" engagement back to awaiting_payment. Honest.
  if (result.engagementId) {
    await syncEngagementStageSR(result.engagementId);
  }
}
