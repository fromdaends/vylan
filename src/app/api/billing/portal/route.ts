import { NextResponse } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getCurrentFirm } from "@/lib/db/firms";

export const runtime = "nodejs";

// POST /api/billing/portal
// Opens the Stripe customer portal so the firm can update card, cancel, etc.
export async function POST() {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
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
