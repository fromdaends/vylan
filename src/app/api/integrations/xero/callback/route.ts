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
  xeroTokenKeyMissing,
  XeroError,
  type XeroConnection,
} from "@/lib/xero/client";
import { createClientImportSession } from "@/lib/db/client-import";
import {
  upsertClientXeroConnection,
  findXeroTenantIdsInUse,
  getClientXeroLinkRefs,
} from "@/lib/db/xero";
import { getFirmQuickbooksStatus } from "@/lib/db/quickbooks";
import {
  XERO_STATE_COOKIE,
  XERO_INTENT_COOKIE,
  XERO_CLIENT_COOKIE,
} from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/xero/callback?code=...&state=...
//
// Where Xero returns the accountant, for BOTH flows:
//   * CLIENT-LIST IMPORT — read the just-authorized org's contacts, stage
//     them, and RELEASE the org link (unless a stored connection uses that
//     org — the app↔org link is one shared object at Xero, so releasing it
//     would sever that client's connection).
//   * PER-CLIENT CONNECT — store the connection for THE CLIENT the flow was
//     started from (clientId rides in an httpOnly cookie, like QuickBooks).
//     The org link is KEPT on success; on failure we deliberately leave it
//     (releasing could sever a pre-existing link, and a retry reuses it).
//
// Xero does NOT put the org id in the callback URL — we list /connections
// filtered by the consent's authentication_event_id (from the access-token JWT).
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
  // Which client a per-client connect is for (absent on an import flow).
  const clientId = cookieStore.get(XERO_CLIENT_COOKIE)?.value || null;

  // Redirect home with a status flag, burning the one-time cookies. Import →
  // the import page; connect → the client's page (where the card shows the
  // outcome).
  function back(status: string, sessionId?: string) {
    const dest =
      !isImport && clientId
        ? new URL(`/${locale}/clients/${clientId}`, url.origin)
        : new URL(`/${locale}/clients/import`, url.origin);
    if (isImport && sessionId) dest.searchParams.set("session", sessionId);
    else if (isImport) dest.searchParams.set("bkimport", status);
    else dest.searchParams.set("xero", status);
    const res = NextResponse.redirect(dest);
    res.cookies.set(XERO_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(XERO_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(XERO_CLIENT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (denied) return back("denied");
  if (!code || !state) return back("error");
  if (!expectedState || state !== expectedState) return back("error");
  if (!isXeroConfigured()) return back("error");
  if (!auth.user || me?.role !== "owner") return back("error");
  // Exactly one flow marker must be present.
  if (!isImport && !clientId) return back("error");
  const firm = await getCurrentFirm();
  if (!firm) return back("error");

  // ── PER-CLIENT CONNECT ─────────────────────────────────────────────────────
  if (!isImport) {
    // Go-live safety re-check (the connect route gates too): never STORE
    // tokens plaintext on the production runtime.
    if (xeroTokenKeyMissing()) return back("enc");
    let connectAccessToken: string | null = null;
    // This consent's org links — released in the finally when nothing was
    // stored, so a failed connect never leaves a lingering link occupying a
    // free-tier slot. Guarded by findXeroTenantIdsInUse: Xero shares one
    // connection object per user+org, so a link whose org is SOME client's
    // stored connection must never be released (it would sever that client).
    let releaseCandidates: { tenantId: string; connectionId: string }[] = [];
    let stored = false;
    try {
      const tokens = await exchangeXeroCodeForTokens(code);
      connectAccessToken = tokens.accessToken;
      const authEventId = authEventIdFromAccessToken(tokens.accessToken);
      const conns = await fetchXeroConnections(tokens.accessToken, authEventId);
      // Without the consent id we can't tell a fresh link from pre-existing
      // ones — proceed only when it's unambiguous.
      if (!authEventId && conns.length > 1) {
        console.error(
          "[xero/callback] auth-event id missing with multiple orgs — cannot tell which org this consent authorized",
        );
        return back("error");
      }
      const conn = conns[0] ?? null;
      if (!conn) return back("error");
      if (conns.length > 1) {
        console.warn(
          `[xero/callback] ${conns.length} orgs in one consent; connecting the first (${conn.tenantName ?? conn.tenantId})`,
        );
      }
      releaseCandidates = (authEventId ? conns : [conn])
        .filter((c) => Boolean(c.connectionId))
        .map((c) => ({ tenantId: c.tenantId, connectionId: c.connectionId }));

      // ONE bookkeeping system per client — re-checked HERE, right before
      // storing (the connect routes gate too, but two flows started in
      // parallel tabs would both pass those early gates; the callback check
      // closes the race so a client can never end up with both providers).
      const qboNow = await getFirmQuickbooksStatus(clientId!);
      if (qboNow?.connected) return back("other");

      // The client's PREVIOUS org link (tenant switch → release the old link
      // after a successful store, or it lingers at Xero forever).
      const previous = await getClientXeroLinkRefs(firm.id, clientId!);

      const org = await fetchXeroOrganisation(tokens.accessToken, conn.tenantId);
      const saved = await upsertClientXeroConnection(firm.id, clientId!, {
        tenantId: conn.tenantId,
        connectionId: conn.connectionId || null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        tenantName: org.name ?? conn.tenantName,
        countryCode: org.countryCode,
        isDemo: org.isDemo,
        connectedBy: auth.user.id,
      });
      if (!saved.ok) {
        // tenant_in_use: this org is already another client's connection — the
        // finally's linked-tenant guard keeps its link safe. The card explains.
        return back(
          saved.reason === "tenant_in_use"
            ? "inuse"
            : saved.reason === "migration_pending"
              ? "setup"
              : "error",
        );
      }
      stored = true;
      // Tenant SWITCH: this client's old org link is now orphaned (its refs
      // were just overwritten) — release it, unless that org is still some
      // client's stored connection.
      if (
        previous &&
        previous.connectionId &&
        previous.tenantId !== conn.tenantId
      ) {
        const linked = await findXeroTenantIdsInUse([previous.tenantId]);
        if (!linked.has(previous.tenantId)) {
          await disconnectXeroConnection(
            tokens.accessToken,
            previous.connectionId,
          );
        }
      }
      return back("done");
    } catch (e) {
      console.error(
        "[xero/callback] per-client connect failed:",
        e instanceof XeroError ? `${e.code} ${e.message}` : e,
      );
      return back("error");
    } finally {
      // Release this consent's fresh link(s) when nothing was stored — never
      // a link whose org is a stored connection (see releaseCandidates note).
      try {
        if (!stored && connectAccessToken && releaseCandidates.length > 0) {
          const linked = await findXeroTenantIdsInUse(
            releaseCandidates.map((c) => c.tenantId),
          );
          for (const c of releaseCandidates) {
            if (!linked.has(c.tenantId)) {
              await disconnectXeroConnection(
                connectAccessToken,
                c.connectionId,
              );
            }
          }
        }
      } catch (e) {
        console.error("[xero/callback] connect link release failed:", e);
      }
    }
  }

  // ── CLIENT-LIST IMPORT ─────────────────────────────────────────────────────
  let accessToken: string | null = null;
  let authEventId: string | null = null;
  // The connections this consent covered — candidates for release in finally.
  let consentConns: XeroConnection[] = [];
  try {
    const tokens = await exchangeXeroCodeForTokens(code);
    accessToken = tokens.accessToken;
    authEventId = authEventIdFromAccessToken(tokens.accessToken);
    const conns = await fetchXeroConnections(tokens.accessToken, authEventId);
    if (!authEventId && conns.length > 1) {
      console.error(
        "[xero/callback] auth-event id missing and multiple orgs connected — cannot tell which org this consent authorized",
      );
      return back("error");
    }
    const conn = conns[0] ?? null;
    if (!conn) return back("error");
    if (conns.length > 1) {
      console.warn(
        `[xero/callback] ${conns.length} orgs in one consent; importing from the first (${conn.tenantName ?? conn.tenantId})`,
      );
    }
    consentConns = authEventId ? conns : [conn];
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
    // Release this consent's org link(s) — an import never keeps a connection
    // — EXCEPT any org that is a STORED per-client connection: the app↔org
    // link is one shared object at Xero, so releasing it would sever that
    // client's live connection (the same hazard as the QuickBooks revoke
    // guard). If the connections read itself was what failed, retry it here
    // (filtered to this consent). Best-effort; never throws.
    try {
      if (accessToken) {
        if (consentConns.length === 0 && authEventId) {
          consentConns = await fetchXeroConnections(
            accessToken,
            authEventId,
          ).catch(() => []);
        }
        const inUse = await findXeroTenantIdsInUse(
          consentConns.map((c) => c.tenantId),
        );
        for (const c of consentConns) {
          if (!c.connectionId) continue;
          if (inUse.has(c.tenantId)) {
            console.warn(
              `[xero/callback] keeping org link ${c.tenantName ?? c.tenantId} — it is a stored client connection`,
            );
            continue;
          }
          await disconnectXeroConnection(accessToken, c.connectionId);
        }
      }
    } catch (e) {
      console.error("[xero/callback] connection release failed:", e);
    }
  }
}
