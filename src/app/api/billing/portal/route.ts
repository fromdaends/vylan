import { NextResponse } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";

export const runtime = "nodejs";

// POST /api/billing/portal
// Opens the Stripe customer portal so the firm can update card, cancel, etc.
export async function POST() {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }
  // Owner-only: only the firm owner manages the subscription / payment method.
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (me.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm?.stripe_customer_id) {
    return NextResponse.json({ error: "no_customer" }, { status: 400 });
  }
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const session = await stripe()!.billingPortal.sessions.create({
    customer: firm.stripe_customer_id,
    return_url: `${appUrl}/billing`,
  });
  return NextResponse.json({ url: session.url });
}
