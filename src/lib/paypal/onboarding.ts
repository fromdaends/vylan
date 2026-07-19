// PayPal Partner Referrals onboarding (Phase 2) — how an accountant connects
// their own PayPal Business account to Vylan, the PayPal analog of Stripe
// Connect Standard onboarding:
//
//   1. createPartnerReferral() asks PayPal for a hosted onboarding link
//      (action_url), tagged with our firm id as tracking_id.
//   2. The accountant completes PayPal's hosted flow (sign in / create a
//      Business account, grant Vylan third-party PAYMENT+REFUND permissions)
//      and lands back on /api/billing/paypal/callback.
//   3. The callback NEVER trusts the return-URL params alone: it resolves the
//      seller's merchant id server-side by tracking_id and reads the
//      authoritative status (payments_receivable, primary_email_confirmed)
//      from the merchant-integrations API before persisting anything.
//
// Status reads require OUR partner merchant id (PAYPAL_PARTNER_MERCHANT_ID).
// Sandbox probe result (2026-07-19): partner referrals is OPEN to our sandbox
// app (201 + action_url), so the real flow is testable end to end in sandbox.

import { paypalFetch } from "./client";
import { isPayPalConfigured, paypalPartnerMerchantId } from "./config";

export type CreateReferralResult =
  | { ok: true; actionUrl: string }
  | {
      ok: false;
      reason: "not_configured" | "not_authorized" | "error";
      detail?: string;
    };

// Ask PayPal for a hosted onboarding link for this firm. tracking_id = firm id
// is the trusted link the callback resolves the seller by.
export async function createPartnerReferral(
  firmId: string,
  returnUrl: string,
): Promise<CreateReferralResult> {
  if (!isPayPalConfigured()) return { ok: false, reason: "not_configured" };
  const res = await paypalFetch("/v2/customer/partner-referrals", {
    method: "POST",
    body: {
      tracking_id: firmId,
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: { features: ["PAYMENT", "REFUND"] },
            },
          },
        },
      ],
      products: ["PPCP"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      partner_config_override: { return_url: returnUrl },
    },
  });
  if (!res) return { ok: false, reason: "error", detail: "auth_failed" };
  const body = res.json as {
    name?: string;
    message?: string;
    links?: { rel?: string; href?: string }[];
  } | null;
  if (res.status === 201) {
    const actionUrl =
      body?.links?.find((l) => l.rel === "action_url")?.href ?? null;
    if (actionUrl) return { ok: true, actionUrl };
    return { ok: false, reason: "error", detail: "no_action_url" };
  }
  // Partner features not enabled for this app (the pending-partner-approval
  // case). Surfaced distinctly so the UI can explain rather than "try again".
  if (
    res.status === 401 ||
    res.status === 403 ||
    body?.name === "NOT_AUTHORIZED" ||
    body?.name === "PERMISSION_DENIED"
  ) {
    return { ok: false, reason: "not_authorized", detail: body?.name };
  }
  console.error(
    "[paypal] partner referral failed:",
    res.status,
    body?.name,
    body?.message,
  );
  return { ok: false, reason: "error", detail: body?.name ?? String(res.status) };
}

export type SellerIntegrationStatus = {
  merchantId: string;
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
  // The THIRD_PARTY grant to our app exists (oauth_integrations non-empty).
  permissionsGranted: boolean;
};

export type SellerStatusResult =
  | { ok: true; status: SellerIntegrationStatus }
  | {
      ok: false;
      reason: "not_configured" | "no_partner_id" | "not_found" | "error";
    };

// The authoritative "can this seller take money through us" read.
export async function getSellerIntegrationStatus(
  sellerMerchantId: string,
): Promise<SellerStatusResult> {
  if (!isPayPalConfigured()) return { ok: false, reason: "not_configured" };
  const partnerId = paypalPartnerMerchantId();
  if (!partnerId) return { ok: false, reason: "no_partner_id" };
  const res = await paypalFetch(
    `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(sellerMerchantId)}`,
  );
  if (!res) return { ok: false, reason: "error" };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (res.status !== 200) {
    console.error("[paypal] merchant-integrations read failed:", res.status);
    return { ok: false, reason: "error" };
  }
  const body = res.json as {
    merchant_id?: string;
    payments_receivable?: boolean;
    primary_email_confirmed?: boolean;
    oauth_integrations?: unknown[];
  } | null;
  if (!body?.merchant_id) return { ok: false, reason: "error" };
  return {
    ok: true,
    status: {
      merchantId: body.merchant_id,
      paymentsReceivable: body.payments_receivable === true,
      primaryEmailConfirmed: body.primary_email_confirmed === true,
      permissionsGranted: (body.oauth_integrations?.length ?? 0) > 0,
    },
  };
}

// Resolve the seller's merchant id from OUR tracking id (the firm id we set on
// the referral) — the server-side source of truth the callback prefers over
// anything in the return URL.
export async function findSellerMerchantIdByTrackingId(
  trackingId: string,
): Promise<string | null> {
  if (!isPayPalConfigured()) return null;
  const partnerId = paypalPartnerMerchantId();
  if (!partnerId) return null;
  const res = await paypalFetch(
    `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations?tracking_id=${encodeURIComponent(trackingId)}`,
  );
  if (!res || res.status !== 200) return null;
  const body = res.json as {
    merchant_id?: string;
    links?: { rel?: string; href?: string }[];
  } | null;
  if (body?.merchant_id) return body.merchant_id;
  // Some responses carry only a self link .../merchant-integrations/{id}.
  const href = body?.links?.find((l) => l.href)?.href ?? null;
  const m = href?.match(/merchant-integrations\/([A-Z0-9]+)/i);
  return m?.[1] ?? null;
}
