import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  isQuickbooksConfigured,
  buildAuthorizeUrl,
  quickbooksProductionKeyMissing,
} from "@/lib/quickbooks/client";

export const runtime = "nodejs";

// Name of the short-lived anti-forgery cookie. The callback verifies the `state`
// Intuit echoes back against this value, so a third party cannot trick an
// accountant into attaching the attacker's QuickBooks company.
export const QBO_STATE_COOKIE = "qbo_oauth_state";

// POST /api/integrations/quickbooks/connect
//
// Starts QuickBooks (Intuit) OAuth for the current firm. Owner-only. Returns the
// Intuit authorization URL the browser redirects to. Stage 1: connection only.
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Owner-only: connecting the firm's QuickBooks is firm-admin (same bar as
  // connecting the Stripe payout account).
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  // Config checks AFTER auth, so an anonymous probe can't learn deployment
  // posture (e.g. "production is running without its encryption key").
  if (!isQuickbooksConfigured()) {
    return NextResponse.json({ error: "quickbooks_not_configured" }, { status: 503 });
  }
  // Go-live safety lock: never START a production OAuth flow while token
  // encryption at rest is unconfigured — the resulting tokens would be stored
  // plaintext. The callback re-checks (defense in depth).
  if (quickbooksProductionKeyMissing()) {
    console.error(
      "[quickbooks/connect] refused: QBO_ENVIRONMENT=production but QBO_TOKEN_ENC_KEY is not set (or not a 32-byte key). Set the key before connecting production companies.",
    );
    return NextResponse.json(
      { error: "quickbooks_encryption_required" },
      { status: 503 },
    );
  }

  const state = randomUUID();
  const url = await buildAuthorizeUrl(state);
  const res = NextResponse.json({ url });
  res.cookies.set(QBO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes is plenty to complete the Intuit approval.
  });
  return res;
}
