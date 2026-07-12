import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";

// Firm-wide DEFAULT invoice automation (migration 0590). Pre-selects the
// invoice choice on every new engagement (still editable per engagement).
// Owner-only firm policy; mirrors the other firm-setting POST routes.

export const runtime = "nodejs";

const MODES = new Set(["off", "on_completion", "delayed"]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const mode = body?.mode;
  const delayRaw = body?.delayDays;
  if (typeof mode !== "string" || !MODES.has(mode)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  // delayDays only meaningful for 'delayed'; clamp to 1..365, else null.
  let delayDays: number | null = null;
  if (mode === "delayed") {
    const n = Math.floor(Number(delayRaw));
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return NextResponse.json({ error: "invalid_delay" }, { status: 400 });
    }
    delayDays = n;
  }

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  try {
    await updateCurrentFirm({
      default_invoice_auto_mode: mode as "off" | "on_completion" | "delayed",
      default_invoice_delay_days: delayDays,
    });
  } catch (e) {
    console.error("[POST /api/firm/invoice-defaults] update failed:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "update_failed", detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mode, delayDays });
}
