import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";

// Firm-level "approve drafts automatically" toggle (migration 1000). Mirrors
// the auto-reject-duplicates route exactly: a plain POST rather than a Server
// Action so the toggle save stays independent of any RSC re-render, with the
// client holding the optimistic state.
//
// OWNER-ONLY, and more pointedly than the other toggles: this one decides
// whether the system may sign off on bookkeeping entries with nobody looking.
// That is a firm-wide policy call, not something a staff member should be able
// to flip for everyone.

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
  const me = await getCurrentUser();
  if (!can(me, "firm.settings")) {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  try {
    await updateCurrentFirm({ auto_approve_bookkeeping_drafts: enabled });
  } catch (e) {
    console.error("[POST /api/firm/auto-approve-drafts] update failed:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "update_failed", detail },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, value: enabled });
}
