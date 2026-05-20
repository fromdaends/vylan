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

// Locate the firm row for a subscription event. Tries three paths in
// priority order, all designed so the founder doesn't have to hand-set
// metadata every time they do a deal:
//
//   1. customer_id link    — the normal/preferred path for any sub that
//                            went through our app's checkout flow.
//   2. metadata.firm_id    — explicit override the founder can set on a
//                            Stripe Dashboard sub; bootstraps the link.
//   3. customer.email      — falls back to matching the Stripe Customer
//                            object's email against users.email. Means
//                            you only need to make sure the email on
//                            the Stripe Customer matches the email the
//                            user signed up with in Relai.
//
// Security note: paths 2 and 3 only fire when the firm row currently
// has NO stripe_customer_id set. We never silently re-link a firm that
// already has a Stripe customer attached — that would let a malicious
// metadata or email match steal the link from a paying customer. Both
// fallbacks are also restricted to data the Stripe account owner
// authored (subscription metadata, customer email on a customer THEY
// created in their dashboard) — no public flow can spoof either.
async function resolveAndLinkFirm(
  sub: Stripe.Subscription,
): Promise<{ id: string; stripe_customer_id: string | null } | null> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const byCustomer = await findFirmForCustomer(customerId);
  if (byCustomer) return byCustomer;
  if (!customerId) return null;

  const sb = getServiceRoleSupabase();

  // Path 2 — metadata.firm_id.
  const metaFirmId = sub.metadata?.firm_id;
  if (typeof metaFirmId === "string" && UUID_RE.test(metaFirmId)) {
    const { data: firm } = await sb
      .from("firms")
      .select("id, stripe_customer_id")
      .eq("id", metaFirmId)
      .maybeSingle();
    if (firm) {
      if (firm.stripe_customer_id && firm.stripe_customer_id !== customerId) {
        console.warn(
          "[billing/webhook] metadata.firm_id already linked to a different customer; refusing to re-link",
          {
            firm_id: metaFirmId,
            current: firm.stripe_customer_id,
            incoming: customerId,
          },
        );
      } else {
        await sb
          .from("firms")
          .update({ stripe_customer_id: customerId })
          .eq("id", metaFirmId);
        return { id: firm.id, stripe_customer_id: customerId };
      }
    } else {
      console.warn(
        "[billing/webhook] metadata.firm_id refers to unknown firm:",
        metaFirmId,
      );
    }
  }

  // Path 3 — fall back to matching the Stripe Customer's email against
  // users.email. Fetches the Customer object from Stripe.
  const s = stripe();
  if (!s) return null;
  let customerEmail: string | null = null;
  try {
    const cust = await s.customers.retrieve(customerId);
    if (!cust.deleted) {
      customerEmail = cust.email ?? null;
    }
  } catch (e) {
    console.warn(
      "[billing/webhook] couldn't fetch customer for email-fallback:",
      e,
    );
    return null;
  }
  if (!customerEmail) {
    console.warn(
      "[billing/webhook] no email on Stripe customer; can't email-link",
      { customerId },
    );
    return null;
  }

  // users.email is citext so the match is case-insensitive.
  const { data: userRow } = await sb
    .from("users")
    .select("firm_id, firms!inner(id, stripe_customer_id)")
    .eq("email", customerEmail)
    .maybeSingle();
  type EmailLinkRow = {
    firm_id: string;
    firms:
      | { id: string; stripe_customer_id: string | null }
      | { id: string; stripe_customer_id: string | null }[]
      | null;
  };
  const row = userRow as EmailLinkRow | null;
  const firmRow = Array.isArray(row?.firms) ? row?.firms[0] : row?.firms;
  if (!row?.firm_id || !firmRow) {
    console.warn(
      "[billing/webhook] no Relai user found for customer email; can't link",
      { customerEmail },
    );
    return null;
  }
  if (
    firmRow.stripe_customer_id &&
    firmRow.stripe_customer_id !== customerId
  ) {
    console.warn(
      "[billing/webhook] email-matched firm is already linked to a different customer; refusing to re-link",
      {
        firm_id: row.firm_id,
        current: firmRow.stripe_customer_id,
        incoming: customerId,
      },
    );
    return null;
  }
  await sb
    .from("firms")
    .update({ stripe_customer_id: customerId })
    .eq("id", row.firm_id);
  return { id: row.firm_id, stripe_customer_id: customerId };
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
      // Custom price with no explicit metadata.plan — default to
      // cabinet_plus (our "full access" tier). The founder can still
      // override per-deal by setting metadata.plan to 'cabinet' or
      // 'solo' when they want a less-than-full tier. Safe because
      // custom prices can only be authored by the Stripe account owner.
      plan = "cabinet_plus";
      console.info(
        "[billing/webhook] custom price with no metadata.plan, defaulting to cabinet_plus:",
        { priceId },
      );
    }
  }

  const sb = getServiceRoleSupabase();
  // current_period_end moved from sub.current_period_end (deprecated in
  // newer API versions) to sub.items.data[0].current_period_end. Read
  // the new location first; fall back to the legacy field.
  const itemPeriodEnd = (
    firstItem as Stripe.SubscriptionItem & { current_period_end?: number }
  )?.current_period_end;
  const subPeriodEnd = (
    sub as Stripe.Subscription & { current_period_end?: number }
  ).current_period_end;
  const resolvedPeriodEnd =
    typeof itemPeriodEnd === "number"
      ? itemPeriodEnd
      : typeof subPeriodEnd === "number"
        ? subPeriodEnd
        : null;
  const updates: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end:
      resolvedPeriodEnd != null
        ? new Date(resolvedPeriodEnd * 1000).toISOString()
        : null,
  };
  if (plan) {
    updates.plan = plan;
  }
  // Auto-convert out of demo mode when a paying subscription becomes
  // active. The firm.is_demo flag is set by the public signup flow so
  // accountants can poke around with sample data; once they've actually
  // paid, the demo banner + gated actions should disappear without the
  // founder running a manual SQL update. Only flip when we actually
  // know the plan tier (otherwise we'd be flipping firms whose plan
  // stayed unchanged but happen to be on trial — keep their demo flag
  // alone).
  if (plan && sub.status === "active") {
    updates.is_demo = false;
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
