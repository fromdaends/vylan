// PayPal Orders v2 — the checkout money path (Phase 3). Both calls are
// SERVER-SIDE and act on behalf of the seller (the accountant), so the money
// settles directly to their PayPal with no platform fee, exactly like Stripe's
// direct charge.
//
//   createOrderForInvoice  intent=CAPTURE, payee.merchant_id = the firm's PayPal
//                          merchant id, amount from OUR invoice row in CAD
//                          (never the browser). custom_id + invoice_id both
//                          carry the invoice id: custom_id rides back on the
//                          capture webhook (Phase 4), and invoice_id gives a
//                          free duplicate-block — PayPal refuses a second
//                          capture of the same invoice_id for one merchant.
//   captureOrder           captures an approved order. COMPLETED => the caller
//                          feeds the unified paid event.
//
// Amounts: PayPal wants a decimal string ("25.00"), so cents are formatted to
// two places. CAD only in v1.

import { paypalFetch } from "./client";
import { isPayPalConfigured } from "./config";

function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export type CreateOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: "not_configured" | "error"; detail?: string };

export async function createOrderForInvoice(input: {
  invoiceId: string;
  amountCents: number;
  currency: string;
  sellerMerchantId: string;
  description?: string | null;
}): Promise<CreateOrderResult> {
  if (!isPayPalConfigured()) return { ok: false, reason: "not_configured" };
  const currency = (input.currency || "cad").toUpperCase();
  const res = await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    sellerMerchantId: input.sellerMerchantId,
    // A stable-ish idempotency key so an accidental double create for the same
    // invoice doesn't spin up two orders. PayPal treats a repeated request id as
    // the same request. (Distinct from the invoice_id duplicate-block below.)
    requestId: `vylan-order-${input.invoiceId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          // The invoice id comes home on the capture + webhook.
          custom_id: input.invoiceId,
          invoice_id: input.invoiceId,
          description: input.description?.slice(0, 127) || undefined,
          amount: {
            currency_code: currency,
            value: centsToDecimalString(input.amountCents),
          },
          // Direct settlement to the accountant. No platform fee anywhere.
          payee: { merchant_id: input.sellerMerchantId },
        },
      ],
    },
  });
  if (!res) return { ok: false, reason: "error", detail: "auth_failed" };
  const body = res.json as { id?: string; name?: string; message?: string } | null;
  if ((res.status === 201 || res.status === 200) && body?.id) {
    return { ok: true, orderId: body.id };
  }
  console.error(
    "[paypal] create order failed:",
    res.status,
    body?.name,
    body?.message,
  );
  return { ok: false, reason: "error", detail: body?.name ?? String(res.status) };
}

export type CaptureOrderResult =
  | {
      ok: true;
      // PayPal order status; "COMPLETED" means the money was captured.
      status: string;
      captureId: string | null;
      // The invoice id PayPal echoes back (custom_id on the capture), so the
      // caller can defend against a mismatched order id.
      customId: string | null;
    }
  | {
      ok: false;
      // already_captured = PayPal rejects a second capture (ORDER_ALREADY_CAPTURED)
      // — benign, the invoice is paid; the caller treats it as "already settled".
      reason: "not_configured" | "already_captured" | "declined" | "error";
      detail?: string;
    };

export async function captureOrder(input: {
  orderId: string;
  sellerMerchantId: string;
}): Promise<CaptureOrderResult> {
  if (!isPayPalConfigured()) return { ok: false, reason: "not_configured" };
  const res = await paypalFetch(
    `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
    {
      method: "POST",
      sellerMerchantId: input.sellerMerchantId,
      // Idempotent capture: a retried capture with the same key won't double-charge.
      requestId: `vylan-capture-${input.orderId}`,
    },
  );
  if (!res) return { ok: false, reason: "error", detail: "auth_failed" };
  const body = res.json as {
    id?: string;
    status?: string;
    name?: string;
    message?: string;
    details?: { issue?: string }[];
    purchase_units?: {
      custom_id?: string;
      payments?: { captures?: { id?: string; status?: string }[] };
    }[];
  } | null;

  if ((res.status === 201 || res.status === 200) && body) {
    const pu = body.purchase_units?.[0];
    const capture = pu?.payments?.captures?.[0];
    return {
      ok: true,
      status: body.status ?? capture?.status ?? "UNKNOWN",
      captureId: capture?.id ?? null,
      customId: pu?.custom_id ?? null,
    };
  }
  const issue = body?.details?.[0]?.issue ?? body?.name;
  // A repeat capture of an order PayPal already captured — the invoice is paid.
  if (issue === "ORDER_ALREADY_CAPTURED") {
    return { ok: false, reason: "already_captured", detail: issue };
  }
  // Instrument declined / payer-side failures distinctly from our errors.
  if (
    issue === "INSTRUMENT_DECLINED" ||
    issue === "PAYER_ACTION_REQUIRED" ||
    res.status === 422
  ) {
    return { ok: false, reason: "declined", detail: issue };
  }
  console.error(
    "[paypal] capture failed:",
    res.status,
    body?.name,
    body?.message,
    issue,
  );
  return { ok: false, reason: "error", detail: issue ?? String(res.status) };
}
