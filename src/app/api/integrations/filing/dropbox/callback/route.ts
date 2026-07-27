import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { saveStorageConnection } from "@/lib/db/filing";
import {
  exchangeDropboxCode,
  fetchDropboxAccountEmail,
  isDropboxFilingConfigured,
  revokeDropboxToken,
} from "@/lib/filing/dropbox/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";
import { DROPBOX_FILING_STATE_COOKIE } from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/filing/dropbox/callback?code=...&state=...
//
// The app uses APP-FOLDER access, so there is no root folder to create and no
// destination to pick: Dropbox itself provisions /Apps/<app name> on first
// write, and every API path is relative to it. The connection stores the app
// folder's display name (for links) and connects fully formed.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user ? await getCurrentUser() : null;
  const locale = me?.locale ?? "en";

  const cookieStore = await cookies();
  const expectedState =
    cookieStore.get(DROPBOX_FILING_STATE_COOKIE)?.value ?? null;

  function back(flag: string) {
    const dest = new URL(`/${locale}/integrations/filing`, url.origin);
    dest.searchParams.set("dropbox", flag);
    const res = NextResponse.redirect(dest);
    res.cookies.set(DROPBOX_FILING_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (!auth.user || !me) return back("session");
  if (me.role !== "owner") return back("owner_only");
  const firm = await getCurrentFirm();
  if (!firm) return back("session");

  if (denied) return back("denied");
  if (!isDropboxFilingConfigured()) return back("config");
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
    const tokens = await exchangeDropboxCode(code);
    if (!tokens.refreshToken) return back("no_refresh");

    const email = await fetchDropboxAccountEmail(tokens.accessToken);
    // The app folder is named after the Dropbox app ("Vylan") — used only to
    // build web links; API paths are app-folder-relative regardless.
    const appFolderName =
      process.env.DROPBOX_FILING_APP_FOLDER?.trim() || "Vylan";

    const saved = await saveStorageConnection({
      firmId: firm.id,
      provider: "dropbox",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      accountEmail: email,
      rootLabel: `Apps/${appFolderName}`,
      providerConfig: {
        appFolderName,
        rootLink: `https://www.dropbox.com/home/Apps/${encodeURIComponent(appFolderName)}`,
      },
      connectedBy: me.id,
    });
    if (saved === "other_provider") {
      await revokeDropboxToken(tokens.accessToken);
      return back("other_provider");
    }
    if (saved !== "ok") {
      await revokeDropboxToken(tokens.accessToken);
      return back("save_failed");
    }
    return back("connected");
  } catch (e) {
    console.error("[filing/dropbox/callback] failed:", (e as Error).message);
    return back("exchange_failed");
  }
}
