import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import { getLatestPaymentRequestForEngagementSR } from "@/lib/db/payment-requests";
import { isPayPalConfigured, paypalEnvironment } from "@/lib/paypal/config";
import { createOrderForInvoice } from "@/lib/paypal/orders";
import { firmPaymentRails } from "@/lib/payments/rails";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_CHECKOUT_PER_TOKEN,
  PORTAL_CHECKOUT_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/portal/paypal/create-order  Body: { token }
//
// The PayPal twin of /api/portal/checkout. Unauthenticated client endpoint: the
// client sends only the magic token; the amount, currency, firm, and the
// accountant's PayPal merchant id are ALL derived server-side — nothing about
// the price comes from the browser. Creates an Orders v2 order with the
// accountant as payee (direct settlement, zero fee) and returns { id } for the
// v6 SDK's createOrder() to resolve to { orderId }.
//
// Double-payment guard (part 1 of 2): refuses unless the invoice is still
// 'requested', so a second rail can't even START a checkout on a paid invoice.
type BlockReason =
  | "paypal_not_configured"
  | "invalid_token"
  | "rate_limited"
  | "not_found"
  | "cancelled"
  | "expired"
  | "paypal_not_connected"
  | "no_open_request"
  | "paypal_error";

function blocked(
  reason: BlockReason,
  status: number,
  context: Record<string, unknown> = {},
): NextResponse {
  console.warn("[portal/paypal/create-order] blocked:", reason, context);
  return NextResponse.json({ error: reason }, { status });
}

export async function POST(request: NextRequest) {
  if (!isPayPalConfigured()) return blocked("paypal_not_configured", 503);

  const body = (await request.json().catch(() => null)) as
    | { token?: string }
    | null;
  const token = body?.token;
  if (typeof token !== "string" || !isValidTokenShape(token)) {
    return blocked("invalid_token", 400);
  }

  // Same per-token + per-IP limits as the Stripe checkout route.
  const ip = ipFromRequest({ headers: { get: (n) => request.headers.get(n) } });
  for (const check of [
    { key: `portal:paypal:token:${token}`, ...PORTAL_CHECKOUT_PER_TOKEN },
    { key: `portal:paypal:ip:${ip}`, ...PORTAL_CHECKOUT_PER_IP },
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
  if (!engagement) return blocked("not_found", 404);
  if (engagement.status === "cancelled") {
    return blocked("cancelled", 400, { engagementId: engagement.id });
  }
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return blocked("expired", 400, { engagementId: engagement.id });
  }

  const { data: firm } = await sb
    .from("firms")
    .select(
      "id, paypal_merchant_id, paypal_payments_receivable, paypal_email_confirmed, paypal_mode",
    )
    .eq("id", engagement.firm_id)
    .maybeSingle();
  const rails = firmPaymentRails(firm, { paypalEnvMode: paypalEnvironment() });
  if (!firm || !rails.paypal || !firm.paypal_merchant_id) {
    return blocked("paypal_not_connected", 409, {
      firmId: engagement.firm_id,
    });
  }

  const pr = await getLatestPaymentRequestForEngagementSR(engagement.id);
  if (!pr || pr.status !== "requested") {
    return blocked("no_open_request", 409, {
      engagementId: engagement.id,
      latestStatus: pr?.status ?? null,
    });
  }

  const order = await createOrderForInvoice({
    invoiceId: pr.id,
    amountCents: pr.amount_cents,
    currency: pr.currency || "cad",
    sellerMerchantId: firm.paypal_merchant_id,
    description: pr.description ?? engagement.title,
  });
  if (!order.ok) {
    console.error(
      "[portal/paypal/create-order] order create failed:",
      order.reason,
      order.detail,
    );
    return NextResponse.json({ error: "paypal_error" }, { status: 502 });
  }

  // Record the order id for reconciliation (best-effort).
  await sb
    .from("payment_requests")
    .update({ paypal_order_id: order.orderId })
    .eq("id", pr.id);

  return NextResponse.json({ id: order.orderId });
}
