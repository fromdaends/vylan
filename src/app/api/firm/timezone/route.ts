import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";

// Firm-level timezone selector. Lives on a plain POST route (same
// reasoning as /api/firm/auto-reject): Server Actions auto-trigger an
// RSC re-render of the surrounding tree, which has thrown opaque
// "Server Components render" errors in production for firm-scoped
// writes (the layout calls getCurrentFirm). A regular fetch sidesteps
// that re-render entirely — the client manages optimistic state.
//
// The set of accepted IANA zones is the same six Canadian zones that
// /settings exposes in its dropdown. We validate server-side too, so a
// crafted POST can't write an arbitrary string into firms.timezone.

const ALLOWED_TIMEZONES = new Set<string>([
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
  "America/Winnipeg",
  "America/Edmonton",
  "America/Vancouver",
]);

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const timezone = body?.timezone;
  if (typeof timezone !== "string" || !ALLOWED_TIMEZONES.has(timezone)) {
    return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await updateCurrentFirm({ timezone });
  } catch (e) {
    console.error("[POST /api/firm/timezone] update failed:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "update_failed", detail },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, value: timezone });
}
