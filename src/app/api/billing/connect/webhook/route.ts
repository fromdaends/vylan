import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import {
  findFirmByConnectAccountId,
  applyConnectAccountStatus,
  clearFirmConnectAccount,
} from "@/lib/db/stripe-connect";
import {
  markPaymentRequestPaidSR,
  markPaymentRequestFailedSR,
} from "@/lib/db/payment-requests";
import { logServiceRoleActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe Connect webhook — SEPARATE endpoint from the subscription webhook
// (/api/billing/webhook). Connect events are signed with their OWN secret
// (STRIPE_CONNECT_WEBHOOK_SECRET) and carry an `account` field identifying the
// connected account, so they must be verified independently.
//
// Phase 2 handles account status. Client-payment events
// (checkout.session.completed, payment_intent.payment_failed) are added in
// Phase 5. All writes go through the service role and are keyed on the
// forge-proof connected-account id, so re-delivery is idempotent.
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") {
    return NextResponse.json(
      { error: "connect_webhook_secret_missing" },
      { status: 503 },
    );
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "no_signature" }, { status: 400 });
  }
  const raw = await request.text();

  const s = stripe()!;
  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error("[connect/webhook] signature verification failed:", e);
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "account.updated":
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      case "account.application.deauthorized":
        // The connected account disconnected Vylan. event.account is the
        // connected-account id (the event.data.object is the application).
        await handleDeauthorized(event.account ?? null);
        break;
      case "checkout.session.completed":
        // A client paid (direct charge on the connected account → this event is
        // delivered to the Connect endpoint).
        await handlePaymentSucceeded(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
    }
  } catch (e) {
    console.error("[connect/webhook] handler failed:", e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleAccountUpdated(account: Stripe.Account) {
  const firm = await findFirmByConnectAccountId(account.id);
  if (!firm) {
    // No firm linked to this account (or pre-migration). Nothing to do.
    return;
  }
  await applyConnectAccountStatus(firm, {
    charges_enabled: account.charges_enabled === true,
    payouts_enabled: account.payouts_enabled === true,
    details_submitted: account.details_submitted === true,
  });
}

async function handleDeauthorized(accountId: string | null) {
  if (!accountId) return;
  const firm = await findFirmByConnectAccountId(accountId);
  if (!firm) return;
  await clearFirmConnectAccount(firm.id);
}

async function handlePaymentSucceeded(session: Stripe.Checkout.Session) {
  // Only our one-off payment-request checkouts carry a payment_request_id.
  if (session.mode !== "payment") return;
  const prId = session.metadata?.payment_request_id;
  if (!prId) return;
  // Confirm Stripe actually collected the money (not just that the session
  // completed). The signed event already proves authenticity; the id was set by
  // our checkout route, so trusting metadata here is safe.
  if (session.payment_status !== "paid") return;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  // markPaid is idempotent (no-op if already paid), so a re-delivered event
  // can't double-process.
  const result = await markPaymentRequestPaidSR(prId, {
    checkoutSessionId: session.id,
    paymentIntentId,
  });
  if (result) {
    await logServiceRoleActivity(result.firmId, result.engagementId, "client_paid", {
      amount_cents: result.amountCents,
      currency: result.currency,
      payment_request_id: prId,
    });
  }
}

async function handlePaymentFailed(pi: Stripe.PaymentIntent) {
  const prId = pi.metadata?.payment_request_id;
  if (!prId) return;
  const result = await markPaymentRequestFailedSR(prId);
  if (result) {
    await logServiceRoleActivity(result.firmId, result.engagementId, "payment_failed", {
      payment_request_id: prId,
    });
  }
}
