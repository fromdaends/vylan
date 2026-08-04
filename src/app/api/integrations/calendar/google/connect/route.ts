import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  buildCalendarAuthorizeUrl,
  isGoogleCalendarConfigured,
} from "@/lib/calendar/google/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";

export const runtime = "nodejs";

// Anti-forgery state cookie: the callback verifies the `state` Google echoes
// back against this value, so a third party can't trick somebody into
// attaching the attacker's Google account.
export const GOOGLE_CALENDAR_STATE_COOKIE = "gcal_oauth_state";

// POST /api/integrations/calendar/google/connect
//
// Starts Google OAuth for the agenda card.
//
// NOT owner-gated, and that is the deliberate difference from the filing
// connector next door. Filing decides where the FIRM's client documents land —
// an owner-level decision. This connects YOUR OWN calendar to YOUR OWN
// dashboard panel; requiring the owner's permission to see your own meetings
// would be absurd. Every row is scoped to the connecting user by RLS (1450).
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  // Config checks AFTER auth so an anonymous probe learns nothing about
  // deployment posture.
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  // Go-live safety lock (filing/QBO precedent): never START a production OAuth
  // flow while token encryption at rest is unconfigured — the resulting refresh
  // token would sit in the database in plaintext. The callback re-checks.
  if (
    process.env.NODE_ENV === "production" &&
    !isStorageTokenEncryptionConfigured()
  ) {
    console.error(
      "[calendar/connect] refused: STORAGE_TOKEN_ENC_KEY is not set (or not a 32-byte key). Set the key before connecting a calendar in production.",
    );
    return NextResponse.json({ error: "encryption_required" }, { status: 503 });
  }

  const state = randomUUID();
  const res = NextResponse.json({ url: buildCalendarAuthorizeUrl(state) });
  res.cookies.set(GOOGLE_CALENDAR_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes is plenty to complete the Google approval.
  });
  return res;
}
