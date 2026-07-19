// Self-healing PayPal payment confirmation — the PayPal sibling of
// lib/payments/reconcile.ts (Stripe). Born from a real incident (2026-07-19):
// the buyer APPROVED in PayPal's popup, but the popup's callback to the page
// never fired, so our capture never ran and the invoice sat 'requested'
// forever while the client saw a dead loop.
//
// Given a still-'requested' invoice that has a recorded PayPal order, ask
// PayPal what actually happened:
//   * order APPROVED   -> capture it now (server-side, needs no browser), then
//                         feed the unified paid event on COMPLETED;
//   * order COMPLETED  -> the money already moved (a capture whose record was
//                         lost, or a webhook raced us) — just flip the invoice.
//   * anything else    -> leave it alone (CREATED = buyer never approved;
//                         VOIDED/expired = nothing happened).
//
// Idempotent end to end: the flip is recordInvoicePaid (first-writer-wins) and
// the capture carries a per-order idempotency key. Called on portal load and
// the accountant's engagement page, same as the Stripe reconcile; the Phase 4
// webhook is the other backstop.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  type PaymentRequest,
  type PaymentRequestStatus,
} from "@/lib/db/payment-requests";
import { getOrder, captureOrder } from "@/lib/paypal/orders";
import { isPayPalConfigured } from "@/lib/paypal/config";
import { recordInvoicePaid } from "@/lib/payments/paid-event";

export async function reconcilePayPalOrder(
  paymentRequestId: string,
  sellerMerchantId: string | null,
  opts: {
    // Mirrors the Stripe reconcile: page-render callers historically skip the
    // stage sync (the webhook/capture paths do it). Default true.
    syncStage?: boolean;
  } = {},
): Promise<PaymentRequestStatus | null> {
  if (!isPayPalConfigured()) return null;
  const sb = getServiceRoleSupabase();
  const { data } = await sb
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle();
  const pr = data as PaymentRequest | null;
  if (!pr) return null;
  // Already resolved, or nothing recorded to check against.
  if (pr.status !== "requested") return pr.status;
  if (!pr.paypal_order_id || !sellerMerchantId) return pr.status;

  const order = await getOrder({
    orderId: pr.paypal_order_id,
    sellerMerchantId,
  });
  if (!order.ok) return pr.status;
  // Defence in depth: the order must belong to THIS invoice.
  if (order.customId && order.customId !== pr.id) {
    console.warn(
      "[paypal-reconcile] order/invoice mismatch — not touching:",
      pr.id,
      pr.paypal_order_id,
    );
    return pr.status;
  }

  if (order.status === "COMPLETED" && order.captureStatus === "COMPLETED") {
    await recordInvoicePaid(
      pr.id,
      "paypal",
      { paypalOrderId: pr.paypal_order_id, paypalCaptureId: order.captureId },
      { syncStage: opts.syncStage },
    );
    return "paid";
  }

  if (order.status === "APPROVED") {
    const captured = await captureOrder({
      orderId: pr.paypal_order_id,
      sellerMerchantId,
    });
    if (captured.ok && captured.status === "COMPLETED") {
      await recordInvoicePaid(
        pr.id,
        "paypal",
        {
          paypalOrderId: pr.paypal_order_id,
          paypalCaptureId: captured.captureId,
        },
        { syncStage: opts.syncStage },
      );
      return "paid";
    }
    // A capture PayPal already performed (record lost): same outcome.
    if (!captured.ok && captured.reason === "already_captured") {
      await recordInvoicePaid(
        pr.id,
        "paypal",
        { paypalOrderId: pr.paypal_order_id },
        { syncStage: opts.syncStage },
      );
      return "paid";
    }
    // Declined / transient error: leave 'requested'; the client can retry.
    return pr.status;
  }

  return pr.status;
}
