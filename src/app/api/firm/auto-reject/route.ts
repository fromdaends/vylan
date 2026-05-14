import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";

// Firm-level auto-reject toggle. Lives on a plain POST route instead of
// a Server Action because the action's automatic post-action re-render
// of the surrounding RSC tree was throwing in production (Next.js
// digest-only error from a Server Component in the layout/page render).
// A regular fetch sidesteps that re-render entirely — the client
// already manages the optimistic toggle state.

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

  try {
    await updateCurrentFirm({ auto_reject_unusable_docs: enabled });
  } catch (e) {
    console.error("[POST /api/firm/auto-reject] update failed:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "update_failed", detail },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, value: enabled });
}
