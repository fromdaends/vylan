// /api/search — typeahead endpoint for the global command palette.
// Returns the top matching clients, engagements, and templates for the firm,
// scoped by RLS via the calling user's session. It's the live-data source for
// the palette; static destinations + actions are matched client-side from
// src/lib/search/registry.ts.
//
// Query: ?q=<string>  (server requires at least 2 trimmed chars)
//
// Response shape (kept small + flat so the client renders fast):
//   { clients:    [{ id, display_name, email }, ...]
//   , engagements:[{ id, title, client_id, client_display_name }, ...]
//   , templates:  [{ id, name, is_builtin }, ...]
//   }
//
// Each list is capped server-side at MAX_PER_KIND so a noisy firm can't ship
// hundreds of rows to the browser.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { BLANK_TEMPLATE_ID } from "@/lib/db/templates";

export const dynamic = "force-dynamic";

const MAX_PER_KIND = 6;

const EMPTY = { clients: [], engagements: [], templates: [] };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json(EMPTY);
  }

  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Postgres `ilike` is case-insensitive substring match. % wildcards either
  // side. RLS does the firm scoping.
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;

  const [clientsResp, engagementsResp, templatesResp] = await Promise.all([
    sb
      .from("clients")
      // A name-finder should match the identifiers an accountant actually
      // remembers a client by: name, email, phone, or their own reference.
      // Archived clients are intentionally INCLUDED — this is a "find anything"
      // search, not the active-only list.
      .select("id, display_name, email")
      .or(
        `display_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},external_ref.ilike.${pattern}`,
      )
      .order("display_name", { ascending: true })
      .limit(MAX_PER_KIND),
    sb
      .from("engagements")
      .select("id, title, client_id")
      .ilike("title", pattern)
      // Soft-deleted (Recently Deleted / trash) engagements stay hidden — they
      // have their own view. Archived + cancelled ARE findable here, since the
      // palette is now a whole-app finder rather than an active-work shortcut.
      .is("deleted_at", null)
      // Live engagements first feels right on a typeahead — the accountant is
      // overwhelmingly looking for something they're currently working on.
      .order("status", { ascending: true })
      .limit(MAX_PER_KIND),
    sb
      .from("templates")
      // Built-ins (firm_id null) + the firm's custom templates, by name. The
      // hidden blank clone-source is never a real destination, so exclude it.
      .select("id, name, firm_id")
      .ilike("name", pattern)
      .neq("id", BLANK_TEMPLATE_ID)
      .order("firm_id", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true })
      .limit(MAX_PER_KIND),
  ]);

  const engagements = engagementsResp.data ?? [];
  // Resolve client display_name for each engagement in one batched call so the
  // dropdown can show "T1 2025 — Bouchard" style context.
  const clientIds = Array.from(
    new Set(engagements.map((e) => e.client_id as string)),
  );
  const clientLookupResp = clientIds.length
    ? await sb.from("clients").select("id, display_name").in("id", clientIds)
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
    templates: (templatesResp.data ?? []).map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      // firm_id null = built-in; the editor 404s on built-ins, so the client
      // routes those to the templates gallery instead of the editor.
      is_builtin: tpl.firm_id == null,
    })),
  });
}
