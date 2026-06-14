import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";

// Firm-level "include Quebec tax forms" toggle (migration 0350). When OFF, the
// Quebec-only RL slips are hidden from every client checklist regardless of the
// client's province. Owner-only firm-wide policy; mirrors the other firm-setting
// POST routes (plain POST, the client manages the optimistic state).

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
  // Owner-only: which tax forms a firm uses is a firm-wide policy.
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  try {
    await updateCurrentFirm({ include_quebec_forms: enabled });
  } catch (e) {
    console.error("[POST /api/firm/include-quebec-forms] update failed:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "update_failed", detail },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, value: enabled });
}
