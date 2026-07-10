// GET /api/engagement-chat/engagements — the Assistant panel's engagement
// selector list. Stable API route (not a server action) per the repo's
// deploy-skew policy for client-fetched surfaces.
//
// Auth: cookie session; firm scoping is delegated to RLS (the select can only
// ever see the caller's firm's rows). Returns the active-scope engagements
// (not archived, not soft-deleted) newest first, with the client display name
// for disambiguation — the same lifecycle scope the engagements board shows.

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_LIMIT = 100;

export async function GET() {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("engagements")
    .select("id, title, status, created_at, clients(display_name)")
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  type Row = {
    id: string;
    title: string;
    status: string;
    created_at: string;
    // PostgREST embeds a many-to-one relation as a single object (or null).
    clients: { display_name: string | null } | null;
  };

  const engagements = ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    clientName: row.clients?.display_name ?? null,
  }));

  return NextResponse.json({ engagements });
}
