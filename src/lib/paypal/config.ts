// PayPal environment plumbing — the ONE place that reads PAYPAL_* env vars.
// Mirrors the shape of lib/stripe.ts (isStripeConfigured/stripeKeyMode) and
// lib/quickbooks/client.ts (quickbooksEnvironment) so every PayPal caller asks
// the same questions the Stripe/QBO callers already ask.
//
// FAILS SAFE TO SANDBOX: live PayPal requires PAYPAL_ENVIRONMENT to be exactly
// "live" or "production" (production partner credentials arrive only after
// PayPal approves the partner application). Anything else — blank, "sandbox",
// a typo — is sandbox, so we can never accidentally touch real money.

export type PayPalEnvironment = "sandbox" | "live";

export function paypalEnvironment(): PayPalEnvironment {
  const raw = (process.env.PAYPAL_ENVIRONMENT ?? "").trim().toLowerCase();
  return raw === "live" || raw === "production" ? "live" : "sandbox";
}

export function isPayPalConfigured(): boolean {
  return (
    (process.env.PAYPAL_CLIENT_ID ?? "").trim() !== "" &&
    (process.env.PAYPAL_CLIENT_SECRET ?? "").trim() !== ""
  );
}

export function paypalClientId(): string | null {
  const v = (process.env.PAYPAL_CLIENT_ID ?? "").trim();
  return v === "" ? null : v;
}

export function paypalClientSecret(): string | null {
  const v = (process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
  return v === "" ? null : v;
}

// Our own PayPal merchant id (the PLATFORM's payer id) — required for the
// merchant-integrations status API that verifies a seller really granted Vylan
// third-party permissions. Read from the developer dashboard's account page.
export function paypalPartnerMerchantId(): string | null {
  const v = (process.env.PAYPAL_PARTNER_MERCHANT_ID ?? "").trim();
  return v === "" ? null : v;
}

// The BN code PayPal issues at partner onboarding. Optional in sandbox (the
// partner application is still pending); attached to API calls when present.
export function paypalPartnerAttributionId(): string | null {
  const v = (process.env.PAYPAL_PARTNER_ATTRIBUTION_ID ?? "").trim();
  return v === "" ? null : v;
}

// The id of the webhook registered on our PayPal app (developer dashboard).
// It is PayPal's analog of a Stripe signing secret: verify-webhook-signature
// checks each delivery against it. Absent = the webhook endpoint refuses (503).
export function paypalWebhookId(): string | null {
  const v = (process.env.PAYPAL_WEBHOOK_ID ?? "").trim();
  return v === "" ? null : v;
}

export function paypalApiBase(): string {
  return paypalEnvironment() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

// v6 JS SDK core script (Phase 3 loads this on the portal payment page).
export function paypalSdkUrl(): string {
  return paypalEnvironment() === "live"
    ? "https://www.paypal.com/web-sdk/v6/core"
    : "https://www.sandbox.paypal.com/web-sdk/v6/core";
}

// Where an accountant manages their own PayPal account ("Manage in PayPal").
export function paypalDashboardUrl(): string {
  return paypalEnvironment() === "live"
    ? "https://www.paypal.com"
    : "https://www.sandbox.paypal.com";
}
