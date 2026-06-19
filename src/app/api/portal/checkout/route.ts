import { NextResponse, type NextRequest } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import {
  getLatestPaymentRequestForEngagementSR,
  attachCheckoutSessionSR,
} from "@/lib/db/payment-requests";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_CHECKOUT_PER_TOKEN,
  PORTAL_CHECKOUT_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/portal/checkout  Body: { token }
//
// Unauthenticated client endpoint. The client only sends the magic token; the
// amount, currency, engagement, firm, and the accountant's connected account
// are ALL derived server-side from that token — nothing about the price comes
// from the browser. Creates a Stripe Checkout Session as a DIRECT charge on the
// accountant's connected account (zero platform fee) and returns the hosted URL.
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | { token?: string }
    | null;
  const token = body?.token;
  if (typeof token !== "string" || !isValidTokenShape(token)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  // Rate-limit per token AND per IP — the token is the identity, the IP catches
  // a scripted abuser rotating tokens.
  const ip = ipFromRequest({ headers: { get: (n) => request.headers.get(n) } });
  for (const check of [
    { key: `portal:checkout:token:${token}`, ...PORTAL_CHECKOUT_PER_TOKEN },
    { key: `portal:checkout:ip:${ip}`, ...PORTAL_CHECKOUT_PER_IP },
  ]) {
    const rl = await checkRateLimit(check);
    if (!rl.ok) {
      const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
      if (rl.retryAfter) res.headers.set("Retry-After", String(rl.retryAfter));
      return res;
    }
  }

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, title, status, magic_expires_at")
    .eq("magic_token", token)
    .maybeSingle();
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (engagement.status === "cancelled") {
    return NextResponse.json({ error: "cancelled" }, { status: 400 });
  }
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return NextResponse.json({ error: "expired" }, { status: 400 });
  }

  const { data: firm } = await sb
    .from("firms")
    .select("id, stripe_connect_account_id, connect_charges_enabled")
    .eq("id", engagement.firm_id)
    .maybeSingle();
  if (
    !firm ||
    firm.connect_charges_enabled !== true ||
    !firm.stripe_connect_account_id
  ) {
    return NextResponse.json(
      { error: "not_accepting_payments" },
      { status: 409 },
    );
  }

  const pr = await getLatestPaymentRequestForEngagementSR(engagement.id);
  if (!pr || pr.status !== "requested") {
    return NextResponse.json({ error: "no_open_request" }, { status: 409 });
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const s = stripe()!;
  const meta = {
    payment_request_id: pr.id,
    firm_id: firm.id,
    engagement_id: engagement.id,
  };

  let session;
  try {
    session = await s.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: pr.currency || "cad",
              unit_amount: pr.amount_cents,
              product_data: { name: engagement.title },
            },
            quantity: 1,
          },
        ],
        // DIRECT charge on the connected account (created via stripeAccount
        // below). NO application_fee_amount = zero Vylan fee. The request id
        // rides on both the session and the PaymentIntent so the webhook can
        // mark paid (checkout.session.completed) or failed
        // (payment_intent.payment_failed).
        payment_intent_data: { metadata: meta },
        metadata: meta,
        success_url: `${appUrl}/r/${token}?paid=1`,
        cancel_url: `${appUrl}/r/${token}?paid=0`,
      },
      { stripeAccount: firm.stripe_connect_account_id },
    );
  } catch (e) {
    console.error("[portal/checkout] session create failed:", e);
    return NextResponse.json({ error: "stripe_error" }, { status: 502 });
  }

  // Remember the session id for reconciliation (best-effort).
  await attachCheckoutSessionSR(pr.id, session.id);

  return NextResponse.json({ url: session.url });
}
