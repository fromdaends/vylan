import { NextResponse, type NextRequest } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { priceIdFor, type PlanId } from "@/lib/plans";

export const runtime = "nodejs";

// POST /api/billing/checkout
// Body: { plan: 'solo' | 'cabinet' | 'cabinet_plus' }
// Creates a Stripe Checkout Session and returns the hosted URL.
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | { plan?: string }
    | null;
  const plan = body?.plan as PlanId | undefined;
  if (!plan || plan === "trial") {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }
  const priceId = priceIdFor(plan);
  if (!priceId) {
    return NextResponse.json({ error: "price_not_configured" }, { status: 503 });
  }

  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const s = stripe()!;

  // Reuse the customer if we have one; otherwise let Checkout create it.
  let customerId = firm.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await s.customers.create({
      email: auth.user.email ?? undefined,
      name: firm.name,
      metadata: { firm_id: firm.id },
    });
    customerId = customer.id;
    await sb
      .from("firms")
      .update({ stripe_customer_id: customerId })
      .eq("id", firm.id);
  }

  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/billing?status=success`,
    cancel_url: `${appUrl}/billing?status=cancelled`,
    metadata: { firm_id: firm.id, plan },
    subscription_data: { metadata: { firm_id: firm.id, plan } },
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
