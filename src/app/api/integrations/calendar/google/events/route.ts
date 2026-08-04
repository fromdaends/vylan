import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCalendarProvider } from "@/lib/calendar/provider";

export const runtime = "nodejs";

// GET /api/integrations/calendar/google/events?day=YYYY-MM-DD
//
// One day's events for the SIGNED-IN person. This exists so the agenda card's
// chevrons actually page: the dashboard server-renders today, and moving to
// another day asks here rather than reloading the whole Overview to change one
// panel.
//
// Takes no user id — whose calendar is never a parameter, it is whoever is
// holding the session. The provider reads the caller's own connection and RLS
// (1450) scopes the row to them, so there is no id to tamper with.
export async function GET(request: Request) {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const day = new URL(request.url).searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "bad_day" }, { status: 400 });
  }

  const firm = await getCurrentFirm();
  const timeZone = firm?.timezone ?? "America/Toronto";

  // listEventsForDay never throws — every failure is an empty day (see the
  // note at the top of lib/calendar/google.ts), so the card degrades to
  // "nothing scheduled" instead of showing an error inside a panel.
  const events = await getCalendarProvider().listEventsForDay(day, timeZone);
  return NextResponse.json({ events });
}
