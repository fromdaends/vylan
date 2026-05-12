import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { planForPriceId } from "@/lib/plans";

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

// Locate the firm row by Stripe customer_id. This is the only trusted link
// between a Stripe event and a firm — metadata.firm_id is mutable and not
// safe to use as the sole identifier for upgrade-impacting mutations.
async function findFirmForCustomer(
  customerId: string | null,
): Promise<{ id: string; stripe_customer_id: string | null } | null> {
  if (!customerId) return null;
  const sb = getServiceRoleSupabase();
  const { data } = await sb
    .from("firms")
    .select("id, stripe_customer_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data ?? null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // The session was just initiated by our authenticated user, so trusting
  // metadata.firm_id at this stage is acceptable (the customer can't tamper
  // with the session object between create and the webhook firing). We use
  // it to bootstrap the stripe_customer_id ↔ firm link for the very first
  // subscribe. After this, all subsequent subscription events are matched
  // by customer ID, which can't be forged.
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
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const firm = await findFirmForCustomer(customerId);
  if (!firm) {
    console.warn(
      "[billing/webhook] subscription update for unknown customer",
      customerId,
    );
    return;
  }

  // Derive plan from the price ID on the first subscription item — NEVER
  // from metadata. Metadata can be edited by the user (or by us in error)
  // and trusting it would let an attacker self-upgrade for free.
  const firstItem = sub.items.data[0];
  const priceId =
    typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;
  const plan = priceId ? planForPriceId(priceId) : null;

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
  if (plan) {
    updates.plan = plan;
  } else if (priceId) {
    console.warn(
      "[billing/webhook] unknown price_id, plan unchanged:",
      priceId,
    );
  }
  await sb.from("firms").update(updates).eq("id", firm.id);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const firm = await findFirmForCustomer(customerId);
  if (!firm) return;
  const sb = getServiceRoleSupabase();
  await sb
    .from("firms")
    .update({
      subscription_status: "canceled",
      plan: "trial",
    })
    .eq("id", firm.id);
}
