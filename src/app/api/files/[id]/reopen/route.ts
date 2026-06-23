// Reopen (undo a rejection on) a single uploaded FILE via a STABLE API endpoint
// (POST /api/files/[id]/reopen). Same deploy-skew rationale as the reject route.
// A rejected document offers "Undo" instead of another Reject, so the accountant
// can clear a mistaken rejection; this is the write behind that.
//
// Auth + firm scoping: the file is read under RLS (visible only when its
// engagement belongs to current_firm_id()), which is the authorization check.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { reopenFile } from "@/lib/db/file-review";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }

  // Authorize + resolve context in one RLS-scoped read.
  const { data: row } = await supabase
    .from("uploaded_files")
    .select("request_item_id, engagement_id, engagements!inner(firm_id)")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: "not_found", detail: "File not found." },
      { status: 404 },
    );
  }
  const r = row as {
    request_item_id: string;
    engagement_id: string;
    engagements: { firm_id: string } | { firm_id: string }[];
  };
  const firmId = Array.isArray(r.engagements)
    ? r.engagements[0]?.firm_id
    : r.engagements?.firm_id;

  try {
    await reopenFile(supabase, id);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[reopen file route] failed:", detail, err);
    return NextResponse.json({ error: "reopen_failed", detail });
  }

  try {
    if (firmId) {
      await logUserActivity(firmId, r.engagement_id, "reopen_item", {
        item_id: r.request_item_id,
        file_id: id,
      });
    }
    for (const loc of LOCALES) {
      revalidatePath(`/${loc}/engagements/${r.engagement_id}`);
      revalidatePath(`/${loc}/dashboard`);
    }
  } catch (err) {
    console.error("[reopen file route] post-step failed (reopen applied):", err);
  }

  return NextResponse.json({ ok: true });
}
