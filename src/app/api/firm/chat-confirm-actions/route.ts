import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";

// Firm-level "send confirmation cards" toggle for the engagement assistant
// (migration 0570). When TRUE (default), the assistant proposes actions and
// the accountant confirms a card before anything runs. When FALSE, the server
// carries out proposed actions immediately (deletions still confirm). Owner-
// only firm policy; mirrors the other firm-setting POST routes (plain POST,
// the client manages the optimistic state).

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
    await updateCurrentFirm({ chat_confirm_actions: enabled });
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
