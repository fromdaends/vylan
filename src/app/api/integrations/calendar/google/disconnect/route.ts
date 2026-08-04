import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { disconnectMyCalendar } from "@/lib/db/calendar";
import { revokeCalendarToken } from "@/lib/calendar/google/oauth";

export const runtime = "nodejs";

// POST /api/integrations/calendar/google/disconnect
//
// Turn off your own calendar. Like connect, this is NOT owner-gated — and it
// takes no id, so nobody can disconnect anybody else's: the row is found by the
// caller's own user id, full stop.
//
// The Google grant is revoked as well as the row cleared. A "disconnect" that
// silently keeps a live refresh token to somebody's diary is not a disconnect.
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const result = await disconnectMyCalendar(me.id);
  if (!result) {
    // Nothing was connected. Idempotent on purpose — a double-click, or a
    // disconnect from two tabs, must not produce an error the user has to
    // think about.
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }
  if (result.refreshToken) {
    // Best-effort: the row is already cleared, so a Google outage here cannot
    // leave the person still connected in Vylan.
    await revokeCalendarToken(result.refreshToken);
  }
  return NextResponse.json({ ok: true });
}
