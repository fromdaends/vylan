// Self-healing payment confirmation. The "Paid" flip normally comes from the
// Connect webhook (checkout.session.completed), but if that webhook is delayed
// or misconfigured the payment would stay "requested" forever. So we also
// reconcile directly with Stripe: given a still-"requested" payment that has a
// checkout session, ask Stripe whether that session was actually paid, and flip
// it if so. Webhook-independent, idempotent (markPaid is a no-op once paid).
//
// Called on the portal return (?paid=1, right after the client pays) and when
// the accountant opens the engagement — so the status corrects itself without
// anyone touching Stripe config.

import { stripe } from "@/lib/stripe";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  type PaymentRequest,
  type PaymentRequestStatus,
} from "@/lib/db/payment-requests";
import { recordInvoicePaid } from "@/lib/payments/paid-event";

export async function reconcilePaymentRequest(
  paymentRequestId: string,
  connectedAccountId: string | null,
): Promise<PaymentRequestStatus | null> {
  const sb = getServiceRoleSupabase();
  const { data } = await sb
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle();
  const pr = data as PaymentRequest | null;
  if (!pr) return null;
  // Already resolved, or nothing to check against yet.
  if (pr.status !== "requested") return pr.status;
  if (!pr.stripe_checkout_session_id || !connectedAccountId) return pr.status;

  const s = stripe();
  if (!s) return pr.status;

  try {
    // The session lives on the connected account (direct charge), so it must be
    // retrieved with the stripeAccount option.
    const session = await s.checkout.sessions.retrieve(
      pr.stripe_checkout_session_id,
      undefined,
      { stripeAccount: connectedAccountId },
    );
    if (session.payment_status !== "paid") return pr.status;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);
    // Unified paid event, shared with the webhook — minus the stage sync,
    // which this path (running mid-render) has never done: the stage catches
    // up on the webhook or the next stage event, exactly as before.
    await recordInvoicePaid(
      pr.id,
      "stripe",
      { checkoutSessionId: session.id, paymentIntentId },
      { syncStage: false },
    );
    return "paid";
  } catch (e) {
    console.error("[reconcile] checkout session retrieve failed:", e);
    return pr.status;
  }
}
