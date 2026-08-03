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

import { formatCurrency } from "@/lib/format";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { clientName, emitPaymentEvent } from "@/lib/notifications/emit";
import {
  markPaymentRequestPaidSR,
  markPaymentRequestFailedSR,
  type PaidProvider,
} from "@/lib/db/payment-requests";
import { logServiceRoleActivity } from "@/lib/db/activity";
import { insertRailPaymentSR } from "@/lib/db/invoice-payments";
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
  { outcome: "newly_paid" } | { outcome: "already_settled" };

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

  // Cross-rail closeout: something OTHER than Stripe just settled this
  // invoice, but a Stripe Checkout session created earlier may still be OPEN
  // and able to take a card. Expire it (best-effort — the atomic flip above
  // already makes a second charge unrecordable; this closes the door on the
  // client paying at all). Stripe-paid invoices need nothing: uncaptured
  // PayPal orders are inert.
  //
  // This covers 'manual' too, and that is the case it matters most for: the
  // firm records the cheque that arrived on Friday, and without this the
  // client can still open their portal on Monday and pay the same bill by
  // card. A refund is then the only way out, and refunds are a Stripe
  // dashboard operation in v1.
  if (provider !== "stripe" && result.stripeCheckoutSessionId) {
    await expireOpenStripeCheckout(
      result.firmId,
      result.stripeCheckoutSessionId,
    ).catch(() => {});
  }

  // Mirror the rail's payment into the ledger (migration 1310) so the invoice's
  // payment history is ONE list whatever collected the money, and "collected
  // this month" can be summed from a single place going forward.
  //
  // Skipped for 'manual': recordManualPayment already wrote the ledger row —
  // that row is what completed the invoice and brought us here — and writing a
  // second would double the total (the trigger re-sums the ledger, so the
  // invoice would read as over-paid).
  //
  // Best-effort: the money is already recorded on the invoice, and a ledger
  // write failing must never turn a collected payment into an error.
  if (provider !== "manual") {
    await insertRailPaymentSR({
      firmId: result.firmId,
      paymentRequestId,
      clientId: null,
      engagementId: result.engagementId,
      amountCents: result.amountCents,
      method: provider,
      paidOn: new Date().toISOString().slice(0, 10),
      reference:
        refs.paymentIntentId ?? refs.paypalCaptureId ?? refs.checkoutSessionId ?? null,
      recordedByUserId: null,
    });
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

  await emitPaymentNotification(result, "received", paymentRequestId);
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

  await emitPaymentNotification(result, "failed", paymentRequestId);
}

// Firm-facing notification for a settled or failed client payment. Runs AFTER
// the activity log and the stage sync, so the feed can never announce money
// the ledger has not recorded. The amount is formatted in EN here and blanked
// entirely for recipients on minimal detail — see toCopyVars in
// src/lib/notifications/email.ts.
async function emitPaymentNotification(
  result: {
    firmId: string;
    engagementId: string | null;
    amountCents?: number | null;
    currency?: string | null;
  },
  outcome: "received" | "failed",
  paymentRequestId: string,
): Promise<void> {
  if (!result.engagementId) return;
  // try/catch here, not just inside notify(): building the service-role client
  // THROWS when the environment is incomplete, and that throw would escape into
  // recordInvoicePaid and fail a payment we have already recorded.
  try {
    const sb = getServiceRoleSupabase();
    const { data: engRow } = await sb
      .from("engagements")
      .select("title, client_id")
      .eq("id", result.engagementId)
      .maybeSingle();
    const eng = engRow as { title: string; client_id: string } | null;
    await emitPaymentEvent(
      sb,
      {
        firmId: result.firmId,
        engagementId: result.engagementId,
        engagementTitle: eng?.title ?? null,
        clientId: eng?.client_id ?? null,
        clientName: await clientName(sb, eng?.client_id ?? null),
      },
      {
        outcome,
        amount:
          typeof result.amountCents === "number"
            ? formatCurrency(result.amountCents / 100, "en")
            : null,
        invoiceId: paymentRequestId,
      },
    );
  } catch (err) {
    console.error("[paid-event] payment notification failed:", err);
  }
}
