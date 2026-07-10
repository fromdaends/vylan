// GET /api/engagement-chat/activity?engagementId=… — the Assistant panel's
// Activity tab data. This serves exactly what the old server-rendered
// activity slide-out showed: the engagement's activity_log rows (newest
// first, capped at 100 by listActivityForEngagement) plus the two live
// lookups the timeline needs — current filenames by file id and current
// rejection reasons by item id (the log stores ids, never PII; see the
// Phase 5 rule in activity-timeline.tsx).
//
// Auth: cookie session; authorization is the RLS-scoped engagement read —
// an engagement outside the caller's firm is invisible and 404s.

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { listActivityForEngagement } from "@/lib/db/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const engagementId = new URL(req.url).searchParams.get("engagementId");
  if (!engagementId || !UUID_RE.test(engagementId)) {
    return NextResponse.json({ error: "invalid_engagement" }, { status: 400 });
  }

  // RLS-scoped existence check: a row from another firm (or a bogus id)
  // reads as absent. Missing row = 404, matching the repo's item/file routes.
  const { data: engagement, error: engagementError } = await supabase
    .from("engagements")
    .select("id")
    .eq("id", engagementId)
    .maybeSingle();
  if (engagementError) {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const [entries, filesResult, itemsResult] = await Promise.all([
      listActivityForEngagement(engagementId),
      supabase
        .from("uploaded_files")
        .select("id, original_filename")
        .eq("engagement_id", engagementId),
      supabase
        .from("request_items")
        .select("id, rejection_reason")
        .eq("engagement_id", engagementId),
    ]);
    if (filesResult.error) throw filesResult.error;
    if (itemsResult.error) throw itemsResult.error;

    const filenames: Record<string, string> = {};
    for (const f of (filesResult.data ?? []) as {
      id: string;
      original_filename: string | null;
    }[]) {
      if (f.original_filename) filenames[f.id] = f.original_filename;
    }

    const rejectionReasons: Record<string, string | null> = {};
    for (const i of (itemsResult.data ?? []) as {
      id: string;
      rejection_reason: string | null;
    }[]) {
      rejectionReasons[i.id] = i.rejection_reason ?? null;
    }

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        actor_type: e.actor_type,
        action: e.action,
        metadata: e.metadata,
        created_at: e.created_at,
      })),
      filenames,
      rejectionReasons,
    });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
