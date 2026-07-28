// GET /api/client-messages/conversations — the accountant's cross-client
// message inbox (the social-style conversation list in the Assistant panel),
// plus the pinned internal team-chat conversation when the firm has a team.
//
// Stable API route (not a server action) per the repo's deploy-skew policy for
// client-fetched surfaces. Auth is a cookie session; firm scoping is delegated
// to RLS — every read in listFirmConversations can only ever see the caller's
// firm's rows. Pre-migration (0650 not applied) the loader returns the schema
// sentinel, which we surface as an empty inbox rather than an error.

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { hasActiveTeam } from "@/lib/team/mode";
import { getBrandingImageUrl } from "@/lib/storage";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  listFirmConversations,
} from "@/lib/db/client-messages";
import {
  TEAM_CHAT_SCHEMA_MISSING,
  getTeamChatSummary,
  type TeamConversation,
} from "@/lib/db/team-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Deactivated teammates keep a technically-valid session until they next
  // render the app layout; the panel polls this route without re-running the
  // layout, so enforce the flag here (same guard as the engagement list route).
  const dbUser = await getCurrentUser();
  if (!dbUser || dbUser.deactivated_at) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [conversationsRaw, team] = await Promise.all([
    listFirmConversations(supabase),
    loadTeamConversation(supabase, dbUser.id),
  ]);
  const conversations =
    conversationsRaw === CLIENT_MESSAGING_SCHEMA_MISSING
      ? // Messaging not activated on this environment yet → empty inbox.
        []
      : conversationsRaw;
  return NextResponse.json({ conversations, team });
}

// The pinned team-chat row, or null when it shouldn't exist: the firm hasn't
// turned team mode on (same hasActiveTeam gate as /api/team/messages, so the
// inbox never advertises a thread that route would 403), or migration 0870
// isn't applied yet.
async function loadTeamConversation(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  userId: string,
): Promise<TeamConversation | null> {
  const firm = await getCurrentFirm();
  if (!firm) return null;
  if (
    !hasActiveTeam({
      teamEnabled: firm.team_enabled === true,
      activeMemberCount: 0,
    })
  ) {
    return null;
  }
  const summary = await getTeamChatSummary(supabase, userId);
  if (summary === TEAM_CHAT_SCHEMA_MISSING) return null;
  return {
    ...summary,
    firmName: firm.name,
    logoUrl: await getBrandingImageUrl(firm.logo_url),
  };
}
