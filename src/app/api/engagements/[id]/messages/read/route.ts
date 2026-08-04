// Client messaging read-stamp — COMPATIBILITY SHIM. The real route is
// /api/clients/[id]/messages/read; this one exists so a browser still running
// the pre-1440 bundle keeps clearing its unread badge mid-deploy. It resolves
// the engagement to its client and stamps that client's thread. RLS scopes the
// update to the caller's own firm, and the 0650 column grant whitelists
// firm_last_read_at only.

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

  // RLS-scoped, so a foreign engagement id resolves to nothing.
  const { data: engagement, error } = await supabase
    .from("engagements")
    .select("client_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const clientId = (engagement as { client_id: string } | null)?.client_id;
  if (!clientId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const res = await markThreadReadByFirm(supabase, clientId);
  if (res === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
