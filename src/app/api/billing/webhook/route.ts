import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { planForPriceId, type PlanId } from "@/lib/plans";

// Set of valid plan tiers we'll accept from subscription metadata as a
// fallback when the price ID isn't recognised (i.e. a custom-priced
// subscription created in the Stripe Dashboard for a private deal).
// 'trial' is excluded — paying through a custom price can't downgrade
// anyone back to trial; cancellations route through the deleted handler.
const ALLOWED_FALLBACK_PLANS: ReadonlySet<PlanId> = new Set([
  "solo",
  "cabinet",
  "cabinet_plus",
]);

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Locate the firm row for a subscription event. Tries the customer_id
// link first (the normal/preferred path). If no firm is linked to that
// customer yet — which happens for custom-priced subscriptions the
// founder creates directly in the Stripe Dashboard, since those skip
// our app's checkout flow that would otherwise establish the link — we
// fall back to subscription.metadata.firm_id and bootstrap the link
// right here.
//
// Security note: the fallback only fires when the firm row currently
// has NO stripe_customer_id set. We never silently re-link a firm that
// already has a Stripe customer attached — that would let a malicious
// metadata.firm_id steal the link away from a paying customer. The
// attack surface for setting metadata stays exactly the same as for
// metadata.plan: only the Stripe account owner can author it.
async function resolveAndLinkFirm(
  sub: Stripe.Subscription,
): Promise<{ id: string; stripe_customer_id: string | null } | null> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const byCustomer = await findFirmForCustomer(customerId);
  if (byCustomer) return byCustomer;

  // No firm linked yet. Try metadata.firm_id as the bootstrap.
  const metaFirmId = sub.metadata?.firm_id;
  if (typeof metaFirmId !== "string" || !UUID_RE.test(metaFirmId)) {
    return null;
  }
  if (!customerId) {
    console.warn(
      "[billing/webhook] metadata.firm_id present but subscription has no customer:",
      metaFirmId,
    );
    return null;
  }

  const sb = getServiceRoleSupabase();
  const { data: firm } = await sb
    .from("firms")
    .select("id, stripe_customer_id")
    .eq("id", metaFirmId)
    .maybeSingle();
  if (!firm) {
    console.warn(
      "[billing/webhook] metadata.firm_id refers to unknown firm:",
      metaFirmId,
    );
    return null;
  }
  if (firm.stripe_customer_id && firm.stripe_customer_id !== customerId) {
    console.warn(
      "[billing/webhook] metadata.firm_id already linked to a different customer; refusing to re-link",
      {
        firm_id: metaFirmId,
        current: firm.stripe_customer_id,
        incoming: customerId,
      },
    );
    return null;
  }

  // Bootstrap the link.
  await sb
    .from("firms")
    .update({ stripe_customer_id: customerId })
    .eq("id", metaFirmId);

  return { id: firm.id, stripe_customer_id: customerId };
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
  const firm = await resolveAndLinkFirm(sub);
  if (!firm) {
    const customerId =
      typeof sub.customer === "string"
        ? sub.customer
        : sub.customer?.id ?? null;
    console.warn(
      "[billing/webhook] subscription update for unknown customer",
      { customerId, metaFirmId: sub.metadata?.firm_id ?? null },
    );
    return;
  }

  // Derive plan from the price ID on the first subscription item — NEVER
  // from metadata when the price IS one of our published plans. Metadata
  // is mutable; trusting it for a known-price subscription would let a
  // self-checkout attacker upgrade themselves for free.
  //
  // For UNKNOWN price IDs (i.e. custom-priced subscriptions the founder
  // created in the Stripe Dashboard for private deals), we DO consult
  // subscription metadata.plan as a fallback. The attack surface stays
  // the same because custom prices can only be authored by the Stripe
  // account owner — no public flow ever creates one.
  const firstItem = sub.items.data[0];
  const priceId =
    typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;
  let plan: PlanId | null = priceId ? planForPriceId(priceId) : null;
  if (!plan && priceId) {
    const metaPlan = sub.metadata?.plan;
    if (
      typeof metaPlan === "string" &&
      ALLOWED_FALLBACK_PLANS.has(metaPlan as PlanId)
    ) {
      plan = metaPlan as PlanId;
    } else {
      console.warn(
        "[billing/webhook] custom price with no metadata.plan, plan unchanged:",
        { priceId, metaPlan },
      );
    }
  }

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
