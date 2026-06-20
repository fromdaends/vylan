import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  isQuickbooksConfigured,
  exchangeCodeForTokens,
  fetchCompanyName,
  quickbooksEnvironment,
  QuickbooksError,
} from "@/lib/quickbooks/client";
import { upsertFirmQuickbooksConnection } from "@/lib/db/quickbooks";
import { QBO_STATE_COOKIE } from "../connect/route";

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

  function back(qbo: string) {
    const dest = new URL(`/${locale}/settings`, url.origin);
    dest.searchParams.set("tab", "integrations");
    dest.searchParams.set("qbo", qbo);
    const res = NextResponse.redirect(dest);
    // Always burn the one-time state cookie.
    res.cookies.set(QBO_STATE_COOKIE, "", { path: "/", maxAge: 0 });
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

  try {
    const tokens = await exchangeCodeForTokens(code);
    // One identity-only read for the friendly company name (best-effort; the
    // connection is valid regardless).
    const companyName = await fetchCompanyName(tokens.accessToken, realmId);

    const saved = await upsertFirmQuickbooksConnection(firm.id, {
      realmId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      companyName,
      environment: quickbooksEnvironment(),
      connectedBy: auth.user.id,
    });
    if (!saved.ok) {
      // Pre-migration (0410 not applied) or a DB error: tell the UI to show the
      // "finish setup" note rather than a silent failure.
      return back(saved.reason === "migration_pending" ? "setup" : "error");
    }
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
