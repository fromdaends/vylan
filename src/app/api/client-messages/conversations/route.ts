// GET /api/client-messages/conversations — the accountant's cross-client
// message inbox (the social-style conversation list in the Assistant panel).
//
// Stable API route (not a server action) per the repo's deploy-skew policy for
// client-fetched surfaces. Auth is a cookie session; firm scoping is delegated
// to RLS — every read in listFirmConversations can only ever see the caller's
// firm's rows. Pre-migration (0650 not applied) the loader returns the schema
// sentinel, which we surface as an empty inbox rather than an error.

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  listFirmConversations,
} from "@/lib/db/client-messages";

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

  const conversations = await listFirmConversations(supabase);
  if (conversations === CLIENT_MESSAGING_SCHEMA_MISSING) {
    // Messaging not activated on this environment yet → empty inbox, no error.
    return NextResponse.json({ conversations: [] });
  }
  return NextResponse.json({ conversations });
}
