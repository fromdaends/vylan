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

// Blocked-checkout reason codes. Returned verbatim to the client (which maps
// each to a specific message) AND logged server-side so the exact cause of a
// failed "Pay now" is visible in the Vercel logs instead of a mute 4xx/5xx.
type BlockReason =
  | "stripe_not_configured"
  | "invalid_token"
  | "rate_limited"
  | "not_found"
  | "cancelled"
  | "expired"
  | "not_accepting_payments"
  | "no_open_request"
  | "stripe_error";

// One place to emit the breadcrumb + the JSON body, so no blocked path can
// return silently. context carries the ids that make a prod incident traceable.
function blocked(
  reason: BlockReason,
  status: number,
  context: Record<string, unknown> = {},
): NextResponse {
  console.warn("[portal/checkout] blocked:", reason, context);
  return NextResponse.json({ error: reason }, { status });
}

// The connected account can't be operated by THIS environment's Stripe key.
// The dominant cause is a mode mismatch: a live key can't touch a test-mode
// connected account (or vice versa), so Stripe raises account_invalid /
// "No such account". A firm can look "ready" in our DB (connect_charges_enabled
// was set from a status sync in the OTHER mode) yet be uncharge­able here — this
// distinguishes that permanent, accountant-must-fix state from a transient
// Stripe blip, so the client sees "not accepting payments" rather than "retry".
function isAccountUnusableError(err: {
  type?: string;
  code?: string;
  message?: string;
}): boolean {
  if (err.code === "account_invalid") return true;
  return (
    err.type === "StripeInvalidRequestError" &&
    /no such account|does not exist|cannot be used to access the account/i.test(
      err.message ?? "",
    )
  );
}

// POST /api/portal/checkout  Body: { token }
//
// Unauthenticated client endpoint. The client only sends the magic token; the
// amount, currency, engagement, firm, and the accountant's connected account
// are ALL derived server-side from that token — nothing about the price comes
// from the browser. Creates a Stripe Checkout Session as a DIRECT charge on the
// accountant's connected account (zero platform fee) and returns the hosted URL.
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    // Platform-level: the Vylan Stripe key isn't set in this environment.
    return blocked("stripe_not_configured", 503);
  }

  const body = (await request.json().catch(() => null)) as
    | { token?: string }
    | null;
  const token = body?.token;
  if (typeof token !== "string" || !isValidTokenShape(token)) {
    return blocked("invalid_token", 400);
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
      console.warn("[portal/checkout] blocked: rate_limited", { key: check.key });
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
    return blocked("not_found", 404);
  }
  if (engagement.status === "cancelled") {
    return blocked("cancelled", 400, { engagementId: engagement.id });
  }
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return blocked("expired", 400, {
      engagementId: engagement.id,
      expiredAt: engagement.magic_expires_at,
    });
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
    // The firm can't receive money right now. This is the single most likely
    // cause of a live "Pay now" failure: the accountant hasn't finished Stripe
    // Connect onboarding, disconnected, or the account's charges were disabled.
    return blocked("not_accepting_payments", 409, {
      firmId: engagement.firm_id,
      hasAccount: Boolean(firm?.stripe_connect_account_id),
      chargesEnabled: firm?.connect_charges_enabled === true,
    });
  }

  const pr = await getLatestPaymentRequestForEngagementSR(engagement.id);
  if (!pr || pr.status !== "requested") {
    return blocked("no_open_request", 409, {
      engagementId: engagement.id,
      latestStatus: pr?.status ?? null,
    });
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
    const err = e as { type?: string; code?: string; message?: string };
    // Mode mismatch / unusable account: the firm connected Stripe in a different
    // mode than this environment runs in (classic: test-mode account, live prod
    // key). Retrying can never fix it — the accountant must reconnect. Surface it
    // as a distinct, non-retryable reason so the client sees the right message.
    if (isAccountUnusableError(err)) {
      console.error(
        "[portal/checkout] blocked: account_unusable — connected account not operable by this Stripe key (mode mismatch?):",
        firm.stripe_connect_account_id,
        err.message,
      );
      return NextResponse.json({ error: "account_unusable" }, { status: 409 });
    }
    // Any other Stripe failure (transient outage, currency/amount problem). Log
    // the raw error (server-only) so the exact message is recoverable from logs.
    console.error(
      "[portal/checkout] blocked: stripe_error — session create failed for account",
      firm.stripe_connect_account_id,
      e,
    );
    return NextResponse.json({ error: "stripe_error" }, { status: 502 });
  }

  // Remember the session id for reconciliation (best-effort).
  await attachCheckoutSessionSR(pr.id, session.id);

  return NextResponse.json({ url: session.url });
}
