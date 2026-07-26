import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getFirmStorageConnection } from "@/lib/db/filing";
import {
  buildGoogleAuthorizeUrl,
  isGoogleFilingConfigured,
} from "@/lib/filing/google/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";

export const runtime = "nodejs";

// Anti-forgery state cookie: the callback verifies the `state` Google echoes
// back against this value, so a third party can't trick an owner into
// attaching the attacker's Google account.
export const GOOGLE_FILING_STATE_COOKIE = "gdrive_oauth_state";

// POST /api/integrations/filing/google/connect
//
// Starts Google OAuth for the Drive filing connector. Owner-only (filing
// settings decide where client documents land — same bar as QuickBooks or
// Stripe). Returns the Google authorization URL to redirect to.
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  // Config checks AFTER auth so an anonymous probe learns nothing about
  // deployment posture.
  if (!isGoogleFilingConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  // Go-live safety lock (QBO precedent): never START a production OAuth flow
  // while token encryption at rest is unconfigured — the resulting tokens
  // would be stored plaintext. The callback re-checks (defense in depth).
  if (
    process.env.NODE_ENV === "production" &&
    !isStorageTokenEncryptionConfigured()
  ) {
    console.error(
      "[filing/google/connect] refused: STORAGE_TOKEN_ENC_KEY is not set (or not a 32-byte key). Set the key before connecting storage in production.",
    );
    return NextResponse.json({ error: "encryption_required" }, { status: 503 });
  }

  // v1: one destination per firm. A different provider already connected (or
  // in the reconnectable error state) blocks a Google connect — the firm
  // disconnects the other first. Reconnecting Google itself is fine.
  const existing = await getFirmStorageConnection();
  if (existing && existing.provider !== "google_drive") {
    return NextResponse.json({ error: "other_provider" }, { status: 409 });
  }

  const state = randomUUID();
  const res = NextResponse.json({ url: buildGoogleAuthorizeUrl(state) });
  res.cookies.set(GOOGLE_FILING_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes is plenty to complete the Google approval.
  });
  return res;
}
