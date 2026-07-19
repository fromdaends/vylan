import { NextResponse, type NextRequest } from "next/server";
import { isPayPalConfigured, paypalWebhookId } from "@/lib/paypal/config";
import {
  verifyPayPalWebhookSignature,
  handlePayPalWebhookEvent,
  type PayPalWebhookEvent,
} from "@/lib/paypal/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PayPal webhook — the PayPal analog of /api/billing/connect/webhook. Every
// delivery is verified against OUR registered webhook id via PayPal's
// verify-webhook-signature API before anything is believed; the dispatch (and
// all its idempotency) lives in lib/paypal/webhook.ts.
//
// 200 on handled AND on verified-but-ignored events (so PayPal stops
// retrying); 400 on bad signatures; 503 when the platform isn't configured
// (mirrors the Stripe webhooks' missing-secret behavior).
export async function POST(request: NextRequest) {
  if (!isPayPalConfigured()) {
    return NextResponse.json({ error: "paypal_not_configured" }, { status: 503 });
  }
  if (!paypalWebhookId()) {
    return NextResponse.json(
      { error: "paypal_webhook_id_missing" },
      { status: 503 },
    );
  }

  const event = (await request.json().catch(() => null)) as
    | PayPalWebhookEvent
    | null;
  if (!event || typeof event.event_type !== "string") {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const verdict = await verifyPayPalWebhookSignature(
    {
      transmissionId: request.headers.get("paypal-transmission-id"),
      transmissionTime: request.headers.get("paypal-transmission-time"),
      transmissionSig: request.headers.get("paypal-transmission-sig"),
      certUrl: request.headers.get("paypal-cert-url"),
      authAlgo: request.headers.get("paypal-auth-algo"),
    },
    event,
  );
  if (verdict === "not_configured") {
    return NextResponse.json(
      { error: "paypal_webhook_id_missing" },
      { status: 503 },
    );
  }
  if (verdict === "rejected") {
    console.error("[paypal/webhook] signature verification rejected");
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }
  if (verdict === "error") {
    // Transient verify failure: 500 so PayPal retries the delivery.
    return NextResponse.json({ error: "verify_unavailable" }, { status: 500 });
  }

  try {
    const outcome = await handlePayPalWebhookEvent(event);
    console.log(
      "[paypal/webhook]",
      event.event_type,
      event.id ?? "no-id",
      "->",
      outcome,
    );
  } catch (e) {
    console.error("[paypal/webhook] handler failed:", event.event_type, e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
