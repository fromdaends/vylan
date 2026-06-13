import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";

// Firm-level "auto-ask the client for missing pages" toggle (migration 0330) —
// a SEPARATE setting from auto-reject-unusable-docs and auto-reject-duplicates,
// with its own column + POST route. Mirrors those routes: a plain POST (not a
// Server Action) so the toggle save stays independent of any RSC re-render; the
// client manages the optimistic state.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Owner-only: missing-page handling is a firm-wide document policy.
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  try {
    await updateCurrentFirm({ auto_request_missing_pages: enabled });
  } catch (e) {
    console.error(
      "[POST /api/firm/auto-request-missing-pages] update failed:",
      e,
    );
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "update_failed", detail },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, value: enabled });
}
