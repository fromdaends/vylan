import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  isXeroConfigured,
  exchangeXeroCodeForTokens,
  authEventIdFromAccessToken,
  fetchXeroConnections,
  fetchXeroOrganisation,
  fetchXeroContactCandidates,
  disconnectXeroConnection,
  XeroError,
} from "@/lib/xero/client";
import { createClientImportSession } from "@/lib/db/client-import";
import { XERO_STATE_COOKIE, XERO_INTENT_COOKIE } from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/xero/callback?code=...&state=...
//
// Where Xero returns the accountant. Phase 1 handles the CLIENT-LIST IMPORT
// flow: verify the anti-forgery state, trade the code for tokens, find the org
// that was just authorized (Xero does NOT put it in the callback URL — we list
// /connections filtered by the consent's authentication_event_id), read its
// contact list, stage the candidates, then RELEASE the connection (DELETE
// /connections/{id}) so nothing persists provider-side and no free-tier
// connection slot stays occupied. The per-client connect flow ships next.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error"); // e.g. access_denied

  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user ? await getCurrentUser() : null;
  const locale = me?.locale ?? "en";

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(XERO_STATE_COOKIE)?.value ?? null;
  const isImport = cookieStore.get(XERO_INTENT_COOKIE)?.value === "import";

  function back(status: string, sessionId?: string) {
    const dest = new URL(`/${locale}/clients/import`, url.origin);
    if (sessionId) dest.searchParams.set("session", sessionId);
    else dest.searchParams.set("bkimport", status);
    const res = NextResponse.redirect(dest);
    res.cookies.set(XERO_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(XERO_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (denied) return back("denied");
  if (!code || !state) return back("error");
  if (!expectedState || state !== expectedState) return back("error");
  if (!isXeroConfigured()) return back("error");
  if (!auth.user || me?.role !== "owner") return back("error");
  // Only the import flow exists in Phase 1; anything else is unexpected.
  if (!isImport) return back("error");
  const firm = await getCurrentFirm();
  if (!firm) return back("error");

  let accessToken: string | null = null;
  let connectionId: string | null = null;
  try {
    const tokens = await exchangeXeroCodeForTokens(code);
    accessToken = tokens.accessToken;
    // Which org did this consent authorize? Filter /connections by the consent's
    // auth event; fall back to the full list if the JWT claim is missing. One
    // flow authorizes ONE org on the standard tiers — if several come back
    // (pre-existing links), take the first of this event and log it.
    const authEventId = authEventIdFromAccessToken(tokens.accessToken);
    const conns = await fetchXeroConnections(tokens.accessToken, authEventId);
    const conn = conns[0] ?? null;
    if (!conn) return back("error");
    if (conns.length > 1) {
      console.warn(
        `[xero/callback] ${conns.length} orgs in one consent; importing from the first (${conn.tenantName ?? conn.tenantId})`,
      );
    }
    connectionId = conn.connectionId || null;
    const org = await fetchXeroOrganisation(tokens.accessToken, conn.tenantId);
    const candidates = await fetchXeroContactCandidates(
      tokens.accessToken,
      conn.tenantId,
    );
    if (candidates.length === 0) return back("empty");
    const sessionId = await createClientImportSession({
      firmId: firm.id,
      provider: "xero",
      sourceName: org.name ?? conn.tenantName,
      candidates,
      createdBy: auth.user.id,
    });
    if (!sessionId) return back("setup"); // pre-0750 or a DB error
    return back("done", sessionId);
  } catch (e) {
    console.error(
      "[xero/callback] client-list import failed:",
      e instanceof XeroError ? `${e.code} ${e.message}` : e,
    );
    return back("error");
  } finally {
    // Always release the org link — an import never keeps a connection (and a
    // lingering link would occupy a free-tier connection slot). Best-effort.
    if (accessToken && connectionId) {
      await disconnectXeroConnection(accessToken, connectionId);
    }
  }
}
