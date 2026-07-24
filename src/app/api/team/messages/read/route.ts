// POST /api/team/messages/read — stamp the caller's last-read pointer for the
// firm's team chat (fire-and-forget from the client on open / on new arrival).

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  TEAM_CHAT_SCHEMA_MISSING,
  markTeamReadByUser,
} from "@/lib/db/team-messages";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await getServerSupabase();
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm || !user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const res = await markTeamReadByUser(supabase, firm.id, user.id);
  if (res === TEAM_CHAT_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
