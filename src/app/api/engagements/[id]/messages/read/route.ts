// Client messaging (Phase 1): stamp "the firm has read this engagement's
// thread as of now". Called when the accountant opens the Messages tab.
// No-op when the thread doesn't exist yet (nothing was ever sent). RLS
// scopes the update to the caller's own firm, and the 0650 column grant
// whitelists firm_last_read_at only.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  markThreadReadByFirm,
} from "@/lib/db/client-messages";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const res = await markThreadReadByFirm(supabase, id);
  if (res === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
