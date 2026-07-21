import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getClient } from "@/lib/db/clients";
import { getFirmQuickbooksStatus } from "@/lib/db/quickbooks";
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
// Carries WHICH client a per-client connect is for. httpOnly — never in the
// OAuth `state` round-tripped through Xero — so the client the connection
// binds to can't be tampered with in the callback URL (same design as the
// QuickBooks connect).
export const XERO_CLIENT_COOKIE = "xero_oauth_client";

// POST /api/integrations/xero/connect
//
// Starts Xero OAuth. Owner-only. Two flavors:
//   * { intent: "import" } — client-list import (read-only scopes; nothing
//     stored provider-side).
//   * { clientId } — per-client connect: links THAT client's own Xero
//     organisation (full scopes, connection stored).
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
    clientId?: unknown;
  } | null;
  const isImport = body?.intent === "import";

  // Per-client connect: verify the client belongs to THIS firm (getClient is
  // RLS-scoped — another firm's id returns null) before trusting it.
  let clientId: string | null = null;
  if (!isImport) {
    if (typeof body?.clientId !== "string" || !body.clientId) {
      return NextResponse.json({ error: "no_client" }, { status: 400 });
    }
    const client = await getClient(body.clientId);
    if (!client) {
      return NextResponse.json({ error: "no_client" }, { status: 400 });
    }
    // ONE bookkeeping system per client: a receipt can only belong in one set
    // of books, so a client already connected to QuickBooks can't also connect
    // Xero. (The client page hides the button too; this is the server gate.)
    const qbo = await getFirmQuickbooksStatus(body.clientId);
    if (qbo?.connected) {
      return NextResponse.json({ error: "other_provider" }, { status: 409 });
    }
    clientId = body.clientId;
  }

  const state = randomUUID();
  const res = NextResponse.json({
    // The import consent asks read-only scopes; a per-client connect asks the
    // full set the later phases use (approved once).
    url: buildXeroAuthorizeUrl(state, isImport ? XERO_IMPORT_SCOPES : undefined),
  });
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set(XERO_STATE_COOKIE, state, cookieOpts);
  // Stale-cookie hygiene: exactly one of intent/client is set per flow, and an
  // abandoned earlier attempt must never bleed into this one.
  if (isImport) {
    res.cookies.set(XERO_INTENT_COOKIE, "import", cookieOpts);
    res.cookies.set(XERO_CLIENT_COOKIE, "", { path: "/", maxAge: 0 });
  } else {
    res.cookies.set(XERO_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(XERO_CLIENT_COOKIE, clientId!, cookieOpts);
  }
  return res;
}
