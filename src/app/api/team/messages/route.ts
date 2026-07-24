// Team group chat (migration 0870).
//   GET  /api/team/messages — the firm thread + this user's unread count (poll)
//   POST /api/team/messages — send a message as the current user
//
// API routes (not server actions) for stable URLs across redeploys, mirroring
// the engagement-messages route. Auth + firm scoping are enforced by RLS:
// getServerSupabase carries the member's session, and every read/write is
// policy-checked against current_firm_id(). Firm-internal only — the client is
// never a participant, so there's no service-role path here.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { hasActiveTeam } from "@/lib/team/mode";
import {
  TEAM_CHAT_SCHEMA_MISSING,
  TEAM_MESSAGE_MAX_LENGTH,
  countTeamUnreadForUser,
  getTeamLastReadAt,
  insertTeamMessage,
  listTeamMessages,
  markTeamReadByUser,
} from "@/lib/db/team-messages";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await getServerSupabase();
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm || !user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  if (!hasActiveTeam({ teamEnabled: firm.team_enabled === true, activeMemberCount: 0 })) {
    return NextResponse.json({ error: "not_team" }, { status: 403 });
  }

  const [messages, lastReadAt] = await Promise.all([
    listTeamMessages(supabase),
    getTeamLastReadAt(supabase, user.id),
  ]);
  if (
    messages === TEAM_CHAT_SCHEMA_MISSING ||
    lastReadAt === TEAM_CHAT_SCHEMA_MISSING
  ) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }
  return NextResponse.json({
    messages,
    unread: countTeamUnreadForUser(messages, lastReadAt, user.id),
  });
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm || !user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  if (!hasActiveTeam({ teamEnabled: firm.team_enabled === true, activeMemberCount: 0 })) {
    return NextResponse.json({ error: "not_team" }, { status: 403 });
  }

  const json = (await request.json().catch(() => null)) as {
    body?: unknown;
  } | null;
  const body = typeof json?.body === "string" ? json.body.trim() : "";
  if (body.length === 0 || body.length > TEAM_MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const message = await insertTeamMessage(supabase, {
    firmId: firm.id,
    userId: user.id,
    senderName: userDisplayLabel(user),
    body,
  });
  if (message === TEAM_CHAT_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }

  // Sending implies you've seen the thread — stamp your read pointer so your
  // own message never leaves a stale unread badge. Best-effort.
  try {
    await markTeamReadByUser(supabase, firm.id, user.id);
  } catch (e) {
    console.error("[team-messages] read-stamp after send failed:", e);
  }

  return NextResponse.json({ ok: true, message });
}
