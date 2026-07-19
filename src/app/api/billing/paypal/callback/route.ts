import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { isPayPalConfigured, paypalPartnerMerchantId } from "@/lib/paypal/config";
import {
  findSellerMerchantIdByTrackingId,
  getSellerIntegrationStatus,
} from "@/lib/paypal/onboarding";
import {
  setFirmPayPalConnection,
  applyPayPalSellerStatus,
} from "@/lib/db/paypal-connect";

export const runtime = "nodejs";

// GET /api/billing/paypal/callback
//
// Where PayPal's hosted onboarding sends the accountant back. PayPal appends
// merchantIdInPayPal (the seller's id) and friends to the URL — but URL params
// are forgeable, so nothing here is trusted from the query string alone:
//
//   1. The signed-in OWNER's firm id (server session) picks the firm.
//   2. The seller merchant id is resolved SERVER-SIDE by tracking_id (our firm
//      id, set when the referral was created). The URL param is only a
//      fallback hint, and either way step 3 must pass.
//   3. The merchant-integrations API must confirm the seller actually granted
//      OUR app third-party permissions before anything persists.
//
// Ends in a redirect to Settings -> Payments with ?paypal=<status> so the card
// can show exactly what happened. Statuses: done (connected), pending (linked
// but can't receive yet), partnerid (PAYPAL_PARTNER_MERCHANT_ID missing so we
// can't verify), linked (account already on another firm), clobber (sandbox
// tried to overwrite live), error.
export async function GET(request: NextRequest) {
  const toSettings = (status: string) =>
    NextResponse.redirect(
      new URL(`/settings?tab=payments&paypal=${status}`, request.nextUrl.origin),
    );

  if (!isPayPalConfigured()) return toSettings("error");

  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    // Session expired mid-onboarding: land on login, then Settings.
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") return toSettings("error");
  const firm = await getCurrentFirm();
  if (!firm) return toSettings("error");

  if (!paypalPartnerMerchantId()) {
    // We cannot verify the grant without our own partner id. Store NOTHING
    // (fail closed) and tell the owner what's missing.
    console.warn(
      "[paypal/callback] PAYPAL_PARTNER_MERCHANT_ID missing — cannot verify seller; storing nothing",
    );
    return toSettings("partnerid");
  }

  // Server-side resolution by tracking id; URL param as fallback hint only.
  const urlMerchantId = request.nextUrl.searchParams.get("merchantIdInPayPal");
  const sellerMerchantId =
    (await findSellerMerchantIdByTrackingId(firm.id)) ?? urlMerchantId;
  if (!sellerMerchantId) {
    console.warn("[paypal/callback] no seller merchant id resolvable for firm", firm.id);
    return toSettings("error");
  }

  // The authoritative check: does this seller exist under OUR partner account,
  // with a grant to our app?
  const statusRes = await getSellerIntegrationStatus(sellerMerchantId);
  if (!statusRes.ok) {
    console.warn(
      "[paypal/callback] seller status unreadable:",
      statusRes.reason,
      "firm",
      firm.id,
    );
    return toSettings("error");
  }
  if (!statusRes.status.permissionsGranted) {
    // Onboarding abandoned before granting permissions.
    return toSettings("error");
  }

  const saved = await setFirmPayPalConnection(firm.id, statusRes.status.merchantId);
  if (!saved.ok) {
    return toSettings(
      saved.reason === "already_linked"
        ? "linked"
        : saved.reason === "would_clobber_live"
          ? "clobber"
          : "error",
    );
  }
  await applyPayPalSellerStatus(
    {
      id: firm.id,
      paypal_connected_at:
        (firm as { paypal_connected_at?: string | null }).paypal_connected_at ??
        null,
      paypal_mode:
        (firm as { paypal_mode?: "sandbox" | "live" | null }).paypal_mode ?? null,
    },
    {
      paymentsReceivable: statusRes.status.paymentsReceivable,
      primaryEmailConfirmed: statusRes.status.primaryEmailConfirmed,
    },
  ).catch(() => {
    // Status write is best-effort here; the Settings page self-heals it.
  });

  // No activity-log entry, matching Stripe Connect (connections are firm
  // config, not engagement events; neither rail logs them).
  const ready =
    statusRes.status.paymentsReceivable &&
    statusRes.status.primaryEmailConfirmed;
  return toSettings(ready ? "done" : "pending");
}
