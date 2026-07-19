import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import { getLatestPaymentRequestForEngagementSR } from "@/lib/db/payment-requests";
import { isPayPalConfigured } from "@/lib/paypal/config";
import { captureOrder } from "@/lib/paypal/orders";
import { recordInvoicePaid } from "@/lib/payments/paid-event";

export const runtime = "nodejs";

// POST /api/portal/paypal/capture-order  Body: { token, orderId }
//
// Captures an approved PayPal order (server-side; the browser never captures)
// and, on COMPLETED, feeds the UNIFIED paid event — the same flip + activity +
// stage-sync + lock-unlock path Stripe uses, so a PayPal payment behaves
// identically. The webhook (Phase 4) is the backstop; because both go through
// the idempotent recordInvoicePaid, a later webhook for the same capture no-ops.
//
// Double-payment guard (part 2 of 2): re-checks the invoice is still 'requested'
// BEFORE capturing AND validates the order's invoice id matches, so a race that
// slipped past create-order can't capture onto an already-settled invoice.
type BlockReason =
  | "paypal_not_configured"
  | "invalid_token"
  | "bad_request"
  | "not_found"
  | "no_open_request"
  | "order_mismatch"
  | "paypal_not_connected"
  | "declined"
  | "paypal_error";

function blocked(
  reason: BlockReason,
  status: number,
  context: Record<string, unknown> = {},
): NextResponse {
  console.warn("[portal/paypal/capture-order] blocked:", reason, context);
  return NextResponse.json({ error: reason }, { status });
}

export async function POST(request: NextRequest) {
  if (!isPayPalConfigured()) return blocked("paypal_not_configured", 503);

  const body = (await request.json().catch(() => null)) as
    | { token?: string; orderId?: string }
    | null;
  const token = body?.token;
  const orderId = body?.orderId;
  if (typeof token !== "string" || !isValidTokenShape(token)) {
    return blocked("invalid_token", 400);
  }
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return blocked("bad_request", 400);
  }

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, status")
    .eq("magic_token", token)
    .maybeSingle();
  if (!engagement || engagement.status === "cancelled") {
    return blocked("not_found", 404);
  }

  const { data: firm } = await sb
    .from("firms")
    .select("id, paypal_merchant_id")
    .eq("id", engagement.firm_id)
    .maybeSingle();
  if (!firm?.paypal_merchant_id) {
    return blocked("paypal_not_connected", 409, { firmId: engagement.firm_id });
  }

  // Guard BEFORE capturing: the invoice must still be open, and the order we're
  // about to capture must be the one we recorded for THIS invoice.
  const pr = await getLatestPaymentRequestForEngagementSR(engagement.id);
  if (!pr || pr.status !== "requested") {
    return blocked("no_open_request", 409, {
      engagementId: engagement.id,
      latestStatus: pr?.status ?? null,
    });
  }
  if (pr.paypal_order_id && pr.paypal_order_id !== orderId) {
    return blocked("order_mismatch", 409, {
      engagementId: engagement.id,
      recorded: pr.paypal_order_id,
      got: orderId,
    });
  }

  const result = await captureOrder({
    orderId,
    sellerMerchantId: firm.paypal_merchant_id,
  });

  // PayPal already captured this order (a retry / double-submit): the invoice is
  // effectively paid. Feed the paid event anyway — idempotent, so it flips the
  // invoice if the first capture's record somehow didn't land, else no-ops.
  if (!result.ok && result.reason === "already_captured") {
    await recordInvoicePaid(pr.id, "paypal", { paypalOrderId: orderId });
    return NextResponse.json({ ok: true, status: "COMPLETED" });
  }
  if (!result.ok) {
    if (result.reason === "declined") {
      return blocked("declined", 402, { orderId });
    }
    return blocked("paypal_error", 502, { orderId, detail: result.detail });
  }

  // Defence in depth: PayPal echoes our invoice id as custom_id. If it doesn't
  // match this invoice, do NOT mark it paid (a swapped/forged order id).
  if (result.customId && result.customId !== pr.id) {
    return blocked("order_mismatch", 409, {
      expected: pr.id,
      got: result.customId,
    });
  }

  if (result.status === "COMPLETED") {
    await recordInvoicePaid(pr.id, "paypal", {
      paypalOrderId: orderId,
      paypalCaptureId: result.captureId,
    });
    return NextResponse.json({ ok: true, status: "COMPLETED" });
  }

  // PENDING (eCheck-style) or other non-terminal status: the money isn't in yet.
  // Leave the invoice 'requested'; the webhook (Phase 4) flips it when the
  // capture completes. The client sees a "payment processing" state.
  return NextResponse.json({ ok: true, status: result.status });
}
