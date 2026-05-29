// /api/search — typeahead endpoint for the Home page search bar.
// Returns the top matching clients and engagements for the firm
// scoped by RLS via the calling user's session. NOT a full search
// surface — it's the data source for the dropdown.
//
// Query: ?q=<string>  (server requires at least 2 trimmed chars)
//
// Response shape (kept small + flat so the client renders fast):
//   { clients:    [{ id, display_name, email }, ...]
//   , engagements:[{ id, title, client_id, client_display_name }, ...]
//   }
//
// Each list is capped server-side at MAX_PER_KIND so a noisy firm
// can't ship hundreds of rows to the browser.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_PER_KIND = 6;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ clients: [], engagements: [] });
  }

  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
  }

  // Postgres `ilike` is case-insensitive substring match. % wildcards
  // either side. RLS does the firm scoping.
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;

  const [clientsResp, engagementsResp] = await Promise.all([
    sb
      .from("clients")
      .select("id, display_name, email")
      .is("archived_at", null)
      .or(`display_name.ilike.${pattern},email.ilike.${pattern}`)
      .order("display_name", { ascending: true })
      .limit(MAX_PER_KIND),
    sb
      .from("engagements")
      .select("id, title, client_id")
      .ilike("title", pattern)
      // Live engagements first feels right on a typeahead — the
      // accountant is overwhelmingly looking for something they're
      // currently working on, not something they cancelled months ago.
      .order("status", { ascending: true })
      .limit(MAX_PER_KIND),
  ]);

  const engagements = engagementsResp.data ?? [];
  // Resolve client display_name for each engagement in one batched
  // call so the dropdown can show "T1 2025 — Bouchard" style context.
  const clientIds = Array.from(
    new Set(engagements.map((e) => e.client_id as string)),
  );
  const clientLookupResp = clientIds.length
    ? await sb
        .from("clients")
        .select("id, display_name")
        .in("id", clientIds)
    : { data: [] };
  const nameById = new Map<string, string>();
  for (const c of clientLookupResp.data ?? []) {
    nameById.set(c.id as string, (c.display_name as string) ?? "");
  }

  return NextResponse.json({
    clients: (clientsResp.data ?? []).map((c) => ({
      id: c.id,
      display_name: c.display_name,
      email: c.email,
    })),
    engagements: engagements.map((e) => ({
      id: e.id,
      title: e.title,
      client_id: e.client_id,
      client_display_name: nameById.get(e.client_id as string) ?? null,
    })),
  });
}
