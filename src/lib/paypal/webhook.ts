// PayPal webhook verification + event dispatch (Phase 4) — the always-on
// backstop so a PayPal payment confirms even if nobody reloads a page. Kept
// out of the route file so every branch is unit-testable; the route is a thin
// wrapper.
//
// TRUST MODEL, mirroring the Stripe Connect webhook: nothing in a delivery is
// believed until verify-webhook-signature says PayPal really sent it to OUR
// webhook (PAYPAL_WEBHOOK_ID). After that, the invoice id in custom_id is
// trusted because our own create-order wrote it. Every settle path funnels
// through the unified paid event, so replays and races no-op there.
//
// Events handled:
//   PAYMENT.CAPTURE.COMPLETED   money in -> unified paid event (idempotent)
//   PAYMENT.CAPTURE.DENIED      -> shared failure path (never overwrites paid)
//   PAYMENT.CAPTURE.PENDING     -> nothing (invoice stays owed; the portal
//                                  shows "processing"; COMPLETED follows)
//   CHECKOUT.ORDER.APPROVED     buyer approved but capture may have been lost
//                               (the dead-popup incident) -> reconcile, which
//                               captures server-side when appropriate
//   MERCHANT.ONBOARDING.COMPLETED   a connect whose browser never returned ->
//                                   store + sync the connection by tracking id
//   MERCHANT.PARTNER-CONSENT.REVOKED  seller revoked Vylan from PayPal's side
//                                     -> clear the connection (like Stripe's
//                                     account.application.deauthorized)

import { paypalFetch } from "./client";
import { paypalWebhookId } from "./config";
import {
  recordInvoicePaid,
  recordInvoiceFailed,
} from "@/lib/payments/paid-event";
import { reconcilePayPalOrder } from "@/lib/payments/paypal-reconcile";
import {
  clearFirmPayPalConnection,
  findFirmByPayPalMerchantId,
  firmPayPalMerchantId,
  setFirmPayPalConnection,
  syncFirmPayPalStatus,
} from "@/lib/db/paypal-connect";
import { getServiceRoleSupabase } from "@/lib/supabase/server";

export type PayPalWebhookEvent = {
  id?: string;
  event_type?: string;
  resource_type?: string;
  resource?: Record<string, unknown>;
};

// The five headers PayPal signs each delivery with.
export type PayPalTransmissionHeaders = {
  transmissionId: string | null;
  transmissionTime: string | null;
  transmissionSig: string | null;
  certUrl: string | null;
  authAlgo: string | null;
};

export type VerifyResult = "verified" | "rejected" | "not_configured" | "error";

// Ask PayPal whether this delivery was really signed for OUR webhook.
export async function verifyPayPalWebhookSignature(
  headers: PayPalTransmissionHeaders,
  event: PayPalWebhookEvent,
): Promise<VerifyResult> {
  const webhookId = paypalWebhookId();
  if (!webhookId) return "not_configured";
  if (
    !headers.transmissionId ||
    !headers.transmissionTime ||
    !headers.transmissionSig ||
    !headers.certUrl ||
    !headers.authAlgo
  ) {
    return "rejected";
  }
  const res = await paypalFetch("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  if (!res) return "error";
  const body = res.json as { verification_status?: string } | null;
  if (res.status !== 200) {
    console.error("[paypal/webhook] verify call failed:", res.status);
    return "error";
  }
  return body?.verification_status === "SUCCESS" ? "verified" : "rejected";
}

// Dispatch one VERIFIED event. Returns a short outcome string for logging.
export async function handlePayPalWebhookEvent(
  event: PayPalWebhookEvent,
): Promise<string> {
  const resource = event.resource ?? {};
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      // resource = the capture: id, custom_id (our invoice id), and usually
      // the order id under supplementary_data.related_ids.
      const invoiceId = (resource.custom_id as string | undefined) ?? null;
      if (!invoiceId) return "ignored_no_custom_id";
      const orderId =
        ((resource.supplementary_data as Record<string, unknown> | undefined)
          ?.related_ids as Record<string, unknown> | undefined)?.order_id ??
        null;
      const result = await recordInvoicePaid(invoiceId, "paypal", {
        paypalCaptureId: (resource.id as string | undefined) ?? null,
        paypalOrderId: (orderId as string | null) ?? undefined,
      });
      return result.outcome; // newly_paid | already_settled (replay-safe)
    }

    case "PAYMENT.CAPTURE.DENIED": {
      const invoiceId = (resource.custom_id as string | undefined) ?? null;
      if (!invoiceId) return "ignored_no_custom_id";
      await recordInvoiceFailed(invoiceId, "paypal");
      return "failed_recorded";
    }

    case "PAYMENT.CAPTURE.PENDING":
      // Money not in yet (eCheck-style). The invoice stays owed on purpose;
      // COMPLETED or DENIED follows and settles it.
      return "pending_noop";

    case "CHECKOUT.ORDER.APPROVED": {
      // resource = the order. The buyer approved; if the browser-side capture
      // was lost, the reconcile captures it server-side now.
      const pus = resource.purchase_units as
        | { custom_id?: string }[]
        | undefined;
      const invoiceId = pus?.[0]?.custom_id ?? null;
      if (!invoiceId) return "ignored_no_custom_id";
      const sb = getServiceRoleSupabase();
      const { data: pr } = await sb
        .from("payment_requests")
        .select("id, firm_id")
        .eq("id", invoiceId)
        .maybeSingle();
      if (!pr) return "ignored_unknown_invoice";
      const sellerId = await firmPayPalMerchantId(pr.firm_id as string);
      const status = await reconcilePayPalOrder(pr.id as string, sellerId);
      return `approved_reconciled_${status ?? "unknown"}`;
    }

    case "MERCHANT.ONBOARDING.COMPLETED": {
      // A connect completed on PayPal's side; the browser may never have come
      // back to our callback (a real incident). tracking_id = our firm id.
      const merchantId = (resource.merchant_id as string | undefined) ?? null;
      const firmId = (resource.tracking_id as string | undefined) ?? null;
      if (!merchantId || !firmId) return "ignored_incomplete_onboarding_event";
      const saved = await setFirmPayPalConnection(firmId, merchantId);
      if (!saved.ok) return `onboarding_store_${saved.reason}`;
      await syncFirmPayPalStatus(firmId, merchantId);
      return "onboarding_stored";
    }

    case "MERCHANT.PARTNER-CONSENT.REVOKED": {
      // The seller revoked Vylan's permissions from inside PayPal. Forge-proof
      // lookup by the unique-indexed merchant id, then reset the firm so the
      // UI shows "connect" and no PayPal payment can be attempted.
      const merchantId =
        (resource.merchant_id as string | undefined) ??
        // Some deliveries nest it differently; be liberal in what we accept.
        ((resource as { merchant?: { merchant_id?: string } }).merchant
          ?.merchant_id ??
          null);
      if (!merchantId) return "ignored_no_merchant_id";
      const firm = await findFirmByPayPalMerchantId(merchantId);
      if (!firm) return "ignored_unknown_merchant";
      await clearFirmPayPalConnection(firm.id);
      return "connection_cleared";
    }

    default:
      return "ignored_event_type";
  }
}
