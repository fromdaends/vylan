// Reject a single uploaded FILE via a STABLE API endpoint
// (POST /api/files/[id]/reject) instead of a Server Action — same deploy-skew
// rationale as /api/items/[id]/reject and the add-item route.
//
// Auth + firm scoping: the file is read under RLS (visible only when its
// engagement belongs to current_firm_id()), which is the authorization check.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { rejectFile } from "@/lib/db/file-review";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;

export async function POST(
  request: NextRequest,
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "bad_request", detail: "Could not read the form." },
      { status: 400 },
    );
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 2) {
    return NextResponse.json({ fieldErrors: { reason: "min_2_chars" } });
  }
  if (reason.length > 500) {
    return NextResponse.json({ fieldErrors: { reason: "too_long" } });
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
    await rejectFile(supabase, id, reason, auth.user.id);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[reject file route] failed:", detail, err);
    return NextResponse.json({ error: "reject_failed", detail });
  }

  try {
    if (firmId) {
      await logUserActivity(firmId, r.engagement_id, "reject_item", {
        item_id: r.request_item_id,
        file_id: id,
      });
    }
    for (const loc of LOCALES) {
      revalidatePath(`/${loc}/engagements/${r.engagement_id}`);
      revalidatePath(`/${loc}/dashboard`);
    }
  } catch (err) {
    console.error("[reject file route] post-step failed (reject applied):", err);
  }

  return NextResponse.json({ ok: true });
}
