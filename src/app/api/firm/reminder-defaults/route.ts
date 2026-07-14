import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { normalizeReminderSettings } from "@/lib/reminder-settings";

export const runtime = "nodejs";

async function authorizeOwner() {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "unauthorized", status: 401 } as const;

  const me = await getCurrentUser();
  if (me?.role !== "owner") return { error: "owner_only", status: 403 } as const;
  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.settings || typeof body.settings !== "object") {
    return NextResponse.json({ error: "invalid_settings" }, { status: 400 });
  }

  const authError = await authorizeOwner();
  if (authError) {
    return NextResponse.json(
      { error: authError.error },
      { status: authError.status },
    );
  }

  const settings = normalizeReminderSettings(body.settings);
  settings.enabled = true;

  try {
    await updateCurrentFirm({ default_reminder_settings: settings });
  } catch (error) {
    console.error("[POST /api/firm/reminder-defaults] update failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "update_failed", detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings });
}

export async function DELETE() {
  const authError = await authorizeOwner();
  if (authError) {
    return NextResponse.json(
      { error: authError.error },
      { status: authError.status },
    );
  }

  try {
    await updateCurrentFirm({ default_reminder_settings: null });
  } catch (error) {
    console.error("[DELETE /api/firm/reminder-defaults] update failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "update_failed", detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
