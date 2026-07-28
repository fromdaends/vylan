// Feed + unread count for the bell.
//
// Polled, not realtime. This repo has no realtime infrastructure anywhere
// (see the note in src/components/team/team-chat.tsx) — messaging, the inbox
// and upload status all poll — so a Supabase realtime subscription here would
// be the app's first, with its own RLS surface and connection budget. The bell
// polls on the same cadence as the existing message inbox.
//
// Reads run as the SIGNED-IN user, so RLS is what scopes the rows: this route
// cannot return another user's notifications even if asked to.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { listFeed, unreadCount } from "@/lib/notifications/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const rawLimit = Number(params.get("limit") ?? 20);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_LIMIT)
    : 20;
  const rawOffset = Number(params.get("offset") ?? 0);
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.floor(rawOffset), 0) : 0;
  const unreadOnly = params.get("unread") === "1";
  // The badge alone is the common case (every poll); skip the list for it.
  const countOnly = params.get("countOnly") === "1";

  const sb = await getServerSupabase();

  if (countOnly) {
    return NextResponse.json({ unread: await unreadCount(sb, user.id) });
  }

  const [items, unread] = await Promise.all([
    listFeed(sb, { userId: user.id, limit, offset, unreadOnly }),
    unreadCount(sb, user.id),
  ]);

  return NextResponse.json({ items, unread });
}
