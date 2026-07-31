import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { saveStorageConnection } from "@/lib/db/filing";
import {
  exchangeMicrosoftCode,
  isMicrosoftFilingConfigured,
} from "@/lib/filing/microsoft/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";
import { MS_FILING_STATE_COOKIE } from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/filing/microsoft/callback?code=...&state=...
//
// Where Microsoft returns the owner after approval. Verifies the anti-forgery
// state and stores the encrypted connection in the "choose where to file"
// state (root_label null, no driveId): unlike Google, the DESTINATION — the
// user's OneDrive or a SharePoint library — is a real choice, made in the
// picker dialog the filing page opens next. Every exit lands back on the
// Document filing page with a status flag the page turns into a toast.
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
  const expectedState = cookieStore.get(MS_FILING_STATE_COOKIE)?.value ?? null;

  function back(flag: string) {
    const dest = new URL(`/${locale}/integrations/filing`, url.origin);
    dest.searchParams.set("microsoft", flag);
    const res = NextResponse.redirect(dest);
    res.cookies.set(MS_FILING_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (!auth.user || !me) return back("session");
  if (!can(me, "integrations.manage")) return back("owner_only");
  const firm = await getCurrentFirm();
  if (!firm) return back("session");

  // access_denied covers both the user clicking Cancel AND a tenant whose
  // admin must approve the app first — the card copy explains the second.
  if (denied) return back("denied");
  if (!isMicrosoftFilingConfigured()) return back("config");
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
    const tokens = await exchangeMicrosoftCode(code);
    if (!tokens.refreshToken) {
      // offline_access should always yield one; without it the connection
      // dies within the hour, so refuse now rather than break later.
      return back("no_refresh");
    }

    const saved = await saveStorageConnection({
      firmId: firm.id,
      provider: "microsoft",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      accountEmail: tokens.accountEmail,
      // The "choose where to file" state: no root label, no driveId yet.
      rootLabel: null,
      providerConfig: {},
      connectedBy: me.id,
    });
    if (saved === "other_provider") return back("other_provider");
    if (saved !== "ok") return back("save_failed");
    // "choose" tells the page to open the destination picker immediately.
    return back("choose");
  } catch (e) {
    console.error("[filing/microsoft/callback] failed:", (e as Error).message);
    return back("exchange_failed");
  }
}
