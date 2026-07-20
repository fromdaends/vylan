import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getClient } from "@/lib/db/clients";
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
// Carries WHICH client this connect is for (per-client QuickBooks). Kept in an
// httpOnly cookie — never in the OAuth `state` round-tripped through Intuit — so
// the client the connection binds to can't be tampered with in the callback URL.
// Absent = a firm-level connect (the legacy Settings flow).
export const QBO_CLIENT_COOKIE = "qbo_oauth_client";
// Marks this OAuth flow as a CLIENT-LIST IMPORT (the accountant signs into their
// OWN company; the callback reads its customers, stages them, revokes the tokens
// and stores NO connection). httpOnly like the others.
export const QBO_INTENT_COOKIE = "qbo_oauth_intent";

// POST /api/integrations/quickbooks/connect
//
// Starts QuickBooks (Intuit) OAuth. Owner-only. The body may carry a `clientId`
// to link THAT client's own QuickBooks company (per-client); omitted = the
// legacy firm-level connect. Returns the Intuit authorization URL to redirect to.
export async function POST(request: Request) {
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

  // Two flavors of flow share this route:
  //   * intent "import" — client-list import: the owner signs into their OWN
  //     company; the callback stages its customers and stores NO connection.
  //   * per-client connect (clientId) — links THAT client's company.
  const body = (await request.json().catch(() => null)) as {
    clientId?: unknown;
    intent?: unknown;
  } | null;
  const isImport = body?.intent === "import";

  // Optional per-client connect: verify the named client belongs to THIS firm
  // (getClient is RLS-scoped, so it returns null for another firm's id) before
  // trusting it. Omitted/invalid → a firm-level connect (legacy behavior).
  let clientId: string | null = null;
  if (!isImport && body && typeof body.clientId === "string" && body.clientId) {
    const client = await getClient(body.clientId);
    if (!client) {
      return NextResponse.json({ error: "no_client" }, { status: 400 });
    }
    clientId = body.clientId;
  }

  const state = randomUUID();
  const url = await buildAuthorizeUrl(state);
  const res = NextResponse.json({ url });
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 minutes is plenty to complete the Intuit approval.
  };
  res.cookies.set(QBO_STATE_COOKIE, state, cookieOpts);
  if (clientId) {
    res.cookies.set(QBO_CLIENT_COOKIE, clientId, cookieOpts);
  } else {
    // Clear any stale client cookie so a firm-level connect is never misattributed
    // to a client from an earlier, abandoned per-client attempt.
    res.cookies.set(QBO_CLIENT_COOKIE, "", { path: "/", maxAge: 0 });
  }
  if (isImport) {
    res.cookies.set(QBO_INTENT_COOKIE, "import", cookieOpts);
  } else {
    // Same stale-cookie hygiene for the intent: an abandoned import attempt must
    // never turn a later real connect into an import.
    res.cookies.set(QBO_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
