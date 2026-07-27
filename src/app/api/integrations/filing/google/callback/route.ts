import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { saveStorageConnection } from "@/lib/db/filing";
import {
  exchangeGoogleCode,
  isGoogleFilingConfigured,
  revokeGoogleToken,
} from "@/lib/filing/google/oauth";
import { ensureRootFolder } from "@/lib/filing/connectors/google-drive";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";
import { GOOGLE_FILING_STATE_COOKIE } from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/filing/google/callback?code=...&state=...
//
// Where Google returns the owner after they approve. Verifies the anti-forgery
// state, trades the code for tokens, creates (or finds) the "Vylan" root
// folder — the ONE place the drive.file scope lets Vylan see and file into —
// and stores the encrypted connection. Every exit lands back on the Document
// filing page with a status flag the page turns into a toast.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error"); // e.g. access_denied

  // Resolve user + locale up front so every redirect lands localized.
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user ? await getCurrentUser() : null;
  const locale = me?.locale ?? "en";

  const cookieStore = await cookies();
  const expectedState =
    cookieStore.get(GOOGLE_FILING_STATE_COOKIE)?.value ?? null;

  // Redirect home with a status flag, burning the one-time state cookie.
  function back(flag: string) {
    const dest = new URL(`/${locale}/integrations/filing`, url.origin);
    dest.searchParams.set("google", flag);
    const res = NextResponse.redirect(dest);
    res.cookies.set(GOOGLE_FILING_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (!auth.user || !me) return back("session");
  if (me.role !== "owner") return back("owner_only");
  const firm = await getCurrentFirm();
  if (!firm) return back("session");

  if (denied) return back("denied");
  if (!isGoogleFilingConfigured()) return back("config");
  if (
    process.env.NODE_ENV === "production" &&
    !isStorageTokenEncryptionConfigured()
  ) {
    return back("config");
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return back("state");
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refreshToken) {
      // prompt=consent should always yield one; without it the connection
      // dies within the hour, so refuse now rather than break later.
      return back("no_refresh");
    }

    // Create/find the root folder while the fresh access token is in hand.
    const root = await ensureRootFolder(tokens.accessToken, "Vylan");

    const saved = await saveStorageConnection({
      firmId: firm.id,
      provider: "google_drive",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      accountEmail: tokens.accountEmail,
      rootLabel: "Vylan",
      providerConfig: { rootFolderId: root.folderId, rootLink: root.link },
      connectedBy: me.id,
    });
    if (saved === "other_provider") {
      // Another provider got connected while this flow was in-flight. Kill
      // the grant we just minted — we're not keeping these tokens.
      await revokeGoogleToken(tokens.refreshToken);
      return back("other_provider");
    }
    if (saved !== "ok") {
      await revokeGoogleToken(tokens.refreshToken);
      return back("save_failed");
    }
    return back("connected");
  } catch (e) {
    console.error("[filing/google/callback] failed:", (e as Error).message);
    return back("exchange_failed");
  }
}
