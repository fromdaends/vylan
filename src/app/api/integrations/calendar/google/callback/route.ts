import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { saveCalendarConnection } from "@/lib/db/calendar";
import {
  exchangeCalendarCode,
  isGoogleCalendarConfigured,
  revokeCalendarToken,
} from "@/lib/calendar/google/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";
import { GOOGLE_CALENDAR_STATE_COOKIE } from "../connect/route";

export const runtime = "nodejs";

// GET /api/integrations/calendar/google/callback?code=...&state=...
//
// Where Google returns somebody after they approve. Verifies the anti-forgery
// state, trades the code for tokens, stores the encrypted connection. Every
// exit lands back on the Overview with a status flag the page turns into a
// toast — the agenda card is where they started, so it is where they return.
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
    cookieStore.get(GOOGLE_CALENDAR_STATE_COOKIE)?.value ?? null;

  // Redirect to the dashboard with a status flag, burning the one-time cookie.
  function back(flag: string) {
    const dest = new URL(`/${locale}/dashboard`, url.origin);
    dest.searchParams.set("calendar", flag);
    const res = NextResponse.redirect(dest);
    res.cookies.set(GOOGLE_CALENDAR_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  if (!auth.user || !me) return back("session");
  const firm = await getCurrentFirm();
  if (!firm) return back("session");

  if (denied) return back("denied");
  if (!isGoogleCalendarConfigured()) return back("config");
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
    const tokens = await exchangeCalendarCode(code);
    if (!tokens.refreshToken) {
      // prompt=consent should always yield one; without it the connection dies
      // within the hour, so refuse now rather than break later.
      return back("no_refresh");
    }

    const saved = await saveCalendarConnection({
      userId: me.id,
      firmId: firm.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      accountEmail: tokens.accountEmail,
    });
    if (saved !== "ok") {
      // We are not keeping tokens we failed to store — kill the grant we just
      // minted rather than leaving an orphan with access to somebody's diary.
      await revokeCalendarToken(tokens.refreshToken);
      return back("save_failed");
    }
    return back("connected");
  } catch (e) {
    console.error("[calendar/callback] failed:", (e as Error).message);
    return back("exchange_failed");
  }
}
