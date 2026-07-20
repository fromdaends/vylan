import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  isXeroConfigured,
  buildXeroAuthorizeUrl,
  XERO_IMPORT_SCOPES,
} from "@/lib/xero/client";

export const runtime = "nodejs";

// Anti-forgery state cookie (the callback verifies Xero's echoed `state`).
export const XERO_STATE_COOKIE = "xero_oauth_state";
// Marks this OAuth flow as a CLIENT-LIST IMPORT (the accountant signs into
// their OWN Xero org; the callback reads its contacts, stages them, releases
// the connection, and stores nothing provider-side).
export const XERO_INTENT_COOKIE = "xero_oauth_intent";

// POST /api/integrations/xero/connect
//
// Starts Xero OAuth. Owner-only. Phase 1 supports the client-list IMPORT flow
// ({intent: "import"}); the per-client connect flow ships next (it needs the
// xero_connections storage layer).
export async function POST(request: Request) {
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
  if (!isXeroConfigured()) {
    return NextResponse.json({ error: "xero_not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    intent?: unknown;
  } | null;
  if (body?.intent !== "import") {
    // Per-client connect arrives with the rest of Xero Phase 1.
    return NextResponse.json({ error: "unsupported" }, { status: 400 });
  }

  const state = randomUUID();
  const res = NextResponse.json({
    url: buildXeroAuthorizeUrl(state, XERO_IMPORT_SCOPES),
  });
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set(XERO_STATE_COOKIE, state, cookieOpts);
  res.cookies.set(XERO_INTENT_COOKIE, "import", cookieOpts);
  return res;
}
