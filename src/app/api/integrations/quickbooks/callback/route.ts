import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  isQuickbooksConfigured,
  exchangeCodeForTokens,
  fetchCompanyProfile,
  quickbooksEnvironment,
  quickbooksProductionKeyMissing,
  QuickbooksError,
} from "@/lib/quickbooks/client";
import {
  upsertFirmQuickbooksConnection,
  getFirmQuickbooksRealm,
} from "@/lib/db/quickbooks";
import { purgeFirmQuickbooksCache } from "@/lib/db/quickbooks-cache";
import { purgeFirmLearnedMappings } from "@/lib/db/quickbooks-learned";
import { enqueueQuickbooksSync } from "@/lib/quickbooks/sync";
import { QBO_STATE_COOKIE, QBO_CLIENT_COOKIE } from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/quickbooks/callback?code=...&state=...&realmId=...
//
// Where Intuit returns the accountant after they approve. Verifies the
// anti-forgery state, trades the code for tokens, reads the company name (one
// identity-only call), and stores the connection for THE CLIENT the connect flow
// was started from. The client id rides in an httpOnly cookie set by the connect
// route — connecting always happens from a client's page, so the client is known
// from context (no name-matching, no "which client?" guessing).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const denied = url.searchParams.get("error"); // e.g. access_denied

  // Resolve the user + locale up front so every redirect lands on the right
  // localized page. (The session cookie rides along on this callback.)
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user ? await getCurrentUser() : null;
  const locale = me?.locale ?? "en";

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(QBO_STATE_COOKIE)?.value ?? null;
  // Which client this connect is for — set in an httpOnly cookie by the connect
  // route when the owner clicked "Connect QuickBooks" on that client's page.
  const clientId = cookieStore.get(QBO_CLIENT_COOKIE)?.value || null;

  // Redirect back to the client's page (where connecting happens) with a status
  // flag, burning the one-time cookies. Falls back to Settings only when there is
  // no client id (shouldn't happen for a normal connect).
  function back(qbo: string) {
    const dest = clientId
      ? new URL(`/${locale}/clients/${clientId}`, url.origin)
      : new URL(`/${locale}/settings`, url.origin);
    if (!clientId) dest.searchParams.set("tab", "integrations");
    dest.searchParams.set("qbo", qbo);
    const res = NextResponse.redirect(dest);
    // Always burn the one-time cookies.
    res.cookies.set(QBO_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(QBO_CLIENT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  // The accountant cancelled on Intuit's screen.
  if (denied) return back("denied");
  // Anti-forgery + completeness checks.
  if (!code || !state || !realmId) return back("error");
  if (!expectedState || state !== expectedState) return back("error");
  if (!isQuickbooksConfigured()) return back("error");

  // Must be an authenticated owner of a firm to store the connection.
  if (!auth.user || me?.role !== "owner") return back("error");
  // Connecting is always for a specific client (started from that client's page).
  if (!clientId) return back("error");
  const firm = await getCurrentFirm();
  if (!firm) return back("error");

  // Go-live safety lock (re-checked here in case the flow was started before the
  // env changed): never STORE production tokens while encryption is unconfigured.
  if (quickbooksProductionKeyMissing()) {
    console.error(
      "[quickbooks/callback] refused to store a production connection: QBO_TOKEN_ENC_KEY is not set (or not a 32-byte key).",
    );
    return back("enc");
  }

  try {
    // Remember which company this client was connected to BEFORE the upsert, so we
    // can detect a company change (realm/environment) and purge the old data.
    const previous = await getFirmQuickbooksRealm(firm.id, clientId);

    const tokens = await exchangeCodeForTokens(code);
    // One identity-only read for the friendly company name + country (best-effort;
    // the connection is valid regardless). Country drives the non-US tax field.
    const profile = await fetchCompanyProfile(tokens.accessToken, realmId);

    const environment = quickbooksEnvironment();
    const saved = await upsertFirmQuickbooksConnection(
      firm.id,
      {
        realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        companyName: profile.name,
        companyCountry: profile.country,
        environment,
        connectedBy: auth.user.id,
      },
      clientId,
    );
    if (!saved.ok) {
      // Pre-migration (0710 not applied) or a DB error. Back to the client page
      // with a "finish setup" / error flag — the card shows it on the connect
      // button (the owner sees the section since they're not-yet-connected).
      return back(saved.reason === "migration_pending" ? "setup" : "error");
    }
    // The connected COMPANY changed for this client (different realm, or sandbox
    // <-> production). Cached lists + learned mappings hold the OLD company's
    // internal ids, so purge THIS client's (never another client's). Best-effort:
    // a failure here must not undo the connect.
    if (
      previous &&
      (previous.realmId !== realmId || previous.environment !== environment)
    ) {
      console.warn(
        `[quickbooks/callback] connected company changed for client ${clientId} (realm ${previous.realmId} -> ${realmId}); purging that client's cached lists + learned mappings`,
      );
      await purgeFirmQuickbooksCache(firm.id, clientId);
      await purgeFirmLearnedMappings(firm.id, clientId);
    }
    // Kick off THIS client's first cache sync in the background (best-effort) so
    // its reference lists (accounts/vendors/customers/tax codes/items) populate,
    // ready for posting. Per-client since Phase 3b.
    await enqueueQuickbooksSync(firm.id, clientId);
    return back("done");
  } catch (e) {
    if (e instanceof QuickbooksError) {
      console.error("[quickbooks/callback]", e.code, e.message);
    } else {
      console.error("[quickbooks/callback] unexpected error:", e);
    }
    return back("error");
  }
}
