import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { isPayPalConfigured } from "@/lib/paypal/config";
import { createPartnerReferral } from "@/lib/paypal/onboarding";

export const runtime = "nodejs";

// POST /api/billing/paypal/onboard
//
// Starts (or resumes) PayPal Partner Referrals onboarding for the current firm
// — the PayPal analog of /api/billing/connect/onboard. Returns PayPal's hosted
// action_url; the browser redirects there, the accountant signs in / creates
// their PayPal Business account and grants Vylan third-party permissions, and
// PayPal sends them back to /api/billing/paypal/callback. PayPal collects all
// identity/bank details — Vylan never sees them. Owner-only.
export async function POST(request: NextRequest) {
  if (!isPayPalConfigured()) {
    return NextResponse.json({ error: "paypal_not_configured" }, { status: 503 });
  }
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Owner-only: connecting the firm's payout account is firm-admin.
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  // Partner Referrals has no registered-redirect-URI allowlist (unlike OAuth),
  // so the return URL can follow the CURRENT origin — which makes the flow work
  // on localhost and Vercel previews too, not only the canonical APP_URL.
  const origin = request.nextUrl.origin || process.env.APP_URL || "";
  const result = await createPartnerReferral(
    firm.id,
    `${origin}/api/billing/paypal/callback`,
  );
  if (!result.ok) {
    // not_authorized = partner features not enabled for this PayPal app (the
    // pending-partner-approval case) — surfaced distinctly so the settings card
    // explains instead of suggesting a retry.
    const status =
      result.reason === "not_configured"
        ? 503
        : result.reason === "not_authorized"
          ? 409
          : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ url: result.actionUrl });
}
