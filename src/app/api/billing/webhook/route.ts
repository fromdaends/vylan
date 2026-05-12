import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { PlanId } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe sends events here. We verify the signature and update firm rows.
// The events we care about:
//   * checkout.session.completed   — initial subscribe
//   * customer.subscription.updated — plan change, status change
//   * customer.subscription.deleted — cancellation

export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") {
    return NextResponse.json(
      { error: "webhook_secret_missing" },
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
    console.error("[billing/webhook] signature verification failed:", e);
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
    }
  } catch (e) {
    console.error("[billing/webhook] handler failed:", e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const firmId = session.metadata?.firm_id;
  if (!firmId) return;
  const sb = getServiceRoleSupabase();
  await sb
    .from("firms")
    .update({
      stripe_customer_id:
        typeof session.customer === "string" ? session.customer : null,
      stripe_subscription_id:
        typeof session.subscription === "string" ? session.subscription : null,
    })
    .eq("id", firmId);
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const firmId = (sub.metadata?.firm_id ?? "") as string;
  if (!firmId) return;
  // Plan derived from the first item's price metadata. We set it in
  // checkout's subscription_data.metadata. Fallback to existing.
  const planFromMeta = (sub.metadata?.plan ?? "") as PlanId;
  const sb = getServiceRoleSupabase();
  const periodEnd = (sub as Stripe.Subscription & { current_period_end?: number })
    .current_period_end;
  const updates: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end:
      typeof periodEnd === "number"
        ? new Date(periodEnd * 1000).toISOString()
        : null,
  };
  if (planFromMeta) updates.plan = planFromMeta;
  await sb.from("firms").update(updates).eq("id", firmId);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const firmId = (sub.metadata?.firm_id ?? "") as string;
  if (!firmId) return;
  const sb = getServiceRoleSupabase();
  await sb
    .from("firms")
    .update({
      subscription_status: "canceled",
      plan: "trial",
    })
    .eq("id", firmId);
}
