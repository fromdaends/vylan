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
import { listClients } from "@/lib/db/clients";
import { matchClientByCompanyName } from "@/lib/quickbooks/client-link";
import { QBO_STATE_COOKIE, QBO_CLIENT_COOKIE } from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/quickbooks/callback?code=...&state=...&realmId=...
//
// Where Intuit returns the accountant after they approve. Verifies the
// anti-forgery state, trades the code for tokens, reads the company name (one
// identity-only call), stores the connection per firm (service role), then sends
// the browser back to Settings -> Integrations with a status flag. Stage 1:
// connection only — no financial data, no transactions, no documents.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const denied = url.searchParams.get("error"); // e.g. access_denied

  // Resolve the user + locale up front so every redirect lands on the right
  // localized Settings page. (The session cookie rides along on this callback.)
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user ? await getCurrentUser() : null;
  const locale = me?.locale ?? "en";

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(QBO_STATE_COOKIE)?.value ?? null;
  // Which client this connect is for (per-client QuickBooks), or null for the
  // legacy firm-level connect. Set in an httpOnly cookie by the connect route.
  const clientId = cookieStore.get(QBO_CLIENT_COOKIE)?.value || null;

  // Redirect home, burning the one-time cookies. `target` is the client the
  // connection resolved to: a real id → that client's page; null → Settings ->
  // Integrations (used for errors and the "couldn't match a client" prompt).
  // Defaults to the connect cookie's clientId (set on early-error exits before we
  // know the resolved client). `company` surfaces the connected company name on
  // the no-match prompt so the owner knows which company to link.
  function back(
    qbo: string,
    opts?: { clientId?: string | null; company?: string },
  ) {
    const target = opts && "clientId" in opts ? opts.clientId : clientId;
    const dest = target
      ? new URL(`/${locale}/clients/${target}`, url.origin)
      : new URL(`/${locale}/settings`, url.origin);
    if (!target) dest.searchParams.set("tab", "integrations");
    dest.searchParams.set("qbo", qbo);
    if (opts?.company) dest.searchParams.set("qbo_company", opts.company);
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
    const tokens = await exchangeCodeForTokens(code);
    // One identity-only read for the friendly company name + country (best-effort;
    // the connection is valid regardless). Country drives the non-US tax field.
    const profile = await fetchCompanyProfile(tokens.accessToken, realmId);

    // Resolve WHICH client this connection belongs to. An explicit clientId from
    // the connect cookie (the manual "link this client" fallback) wins; otherwise
    // AUTO-LINK by matching the QuickBooks company name to a Vylan client's name
    // (the founder's rule — so the accountant never picks the client by hand).
    let resolvedClientId = clientId;
    if (!resolvedClientId) {
      const clients = await listClients();
      const match = matchClientByCompanyName(
        profile.name,
        clients.map((c) => ({ id: c.id, name: c.display_name })),
      );
      resolvedClientId = match?.id ?? null;
    }
    // No explicit client and no unambiguous name match: we can't link it. Send the
    // owner back to Settings to pick the client, carrying the company name so the
    // UI can prompt "which client is '[company]'?". Nothing is stored — there's no
    // client to tie it to; the owner links it explicitly (which reconnects with a
    // chosen client). This is the only time linking isn't automatic.
    if (!resolvedClientId) {
      return back("nomatch", { clientId: null, company: profile.name ?? "" });
    }

    // Detect a company change (different realm/env) for THIS client so we can purge
    // the old company's cached lists + learned mappings before storing the new one.
    const previous = await getFirmQuickbooksRealm(firm.id, resolvedClientId);
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
      resolvedClientId,
    );
    if (!saved.ok) {
      // Pre-migration (0710 not applied) or a DB error: show "finish setup".
      return back(saved.reason === "migration_pending" ? "setup" : "error", {
        clientId: resolvedClientId,
      });
    }
    // The connected COMPANY changed for this client (different realm, or sandbox
    // <-> production). Cached lists + learned mappings hold the OLD company's
    // internal ids, so purge THIS client's (never another client's). Best-effort:
    // a failure here must not undo the connect. Per-client list sync + posting land
    // in Phase 3b, so nothing is enqueued here yet.
    if (
      previous &&
      (previous.realmId !== realmId || previous.environment !== environment)
    ) {
      console.warn(
        `[quickbooks/callback] connected company changed for client ${resolvedClientId} (realm ${previous.realmId} -> ${realmId}); purging that client's cached lists + learned mappings`,
      );
      await purgeFirmQuickbooksCache(firm.id, resolvedClientId);
      await purgeFirmLearnedMappings(firm.id, resolvedClientId);
    }
    return back("done", { clientId: resolvedClientId });
  } catch (e) {
    if (e instanceof QuickbooksError) {
      console.error("[quickbooks/callback]", e.code, e.message);
    } else {
      console.error("[quickbooks/callback] unexpected error:", e);
    }
    return back("error");
  }
}
