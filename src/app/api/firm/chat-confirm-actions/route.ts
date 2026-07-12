import { NextResponse, type NextRequest } from "next/server";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";

// Firm-level "send confirmation cards" toggle for the engagement assistant
// (migration 0570). When TRUE (default), the assistant proposes actions and
// the accountant confirms a card before anything runs. When FALSE, the server
// carries out proposed actions immediately (deletions still confirm).
//
// This governs whether the AI may act with no human in the loop, so it is a
// SECURITY control and gets stricter enforcement than the other firm toggles:
// the column has NO authenticated UPDATE grant (0570), and the firm's RLS
// UPDATE policy allows any same-firm member (not just the owner). So we check
// role === 'owner' HERE and write with the SERVICE ROLE — a staff session
// cannot flip this by PATCHing PostgREST directly.

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
  // Owner-only: whether the AI may act without a human confirming is a
  // firm-wide safety policy.
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  try {
    // Service-role write, pinned to the owner's own firm. RLS is bypassed by
    // the service role, so the owner check above is the only gate — which is
    // the point (no non-owner PostgREST path exists).
    const service = getServiceRoleSupabase();
    const { error } = await service
      .from("firms")
      .update({ chat_confirm_actions: enabled })
      .eq("id", me.firm_id);
    if (error) throw error;
  } catch (e) {
    console.error("[POST /api/firm/chat-confirm-actions] update failed:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "update_failed", detail },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, value: enabled });
}
