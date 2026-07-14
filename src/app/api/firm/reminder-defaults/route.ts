import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm, updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { normalizeReminderSettings } from "@/lib/reminder-settings";
import { withReminderDefaultFallback } from "@/lib/reminder-defaults";

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
  } catch (columnError) {
    // Vercel previews may still point at the production database while the
    // Supabase Git integration applies the migration to an isolated branch.
    // Keep previews functional without touching production schema; 0671 moves
    // this value into the dedicated column when the migration goes live.
    console.warn(
      "[POST /api/firm/reminder-defaults] dedicated column unavailable; using compatibility storage:",
      columnError,
    );
    try {
      const firm = await getCurrentFirm();
      if (!firm) {
        return NextResponse.json({ error: "firm_not_found" }, { status: 404 });
      }
      await updateCurrentFirm({
        business_hours: withReminderDefaultFallback(
          firm.business_hours,
          settings,
        ),
      });
    } catch (fallbackError) {
      console.error(
        "[POST /api/firm/reminder-defaults] compatibility update failed:",
        fallbackError,
      );
      const detail =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      return NextResponse.json(
        { error: "update_failed", detail },
        { status: 500 },
      );
    }
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

  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "firm_not_found" }, { status: 404 });
  }

  let columnRemoved = false;
  try {
    await updateCurrentFirm({ default_reminder_settings: null });
    columnRemoved = true;
  } catch (columnError) {
    console.warn(
      "[DELETE /api/firm/reminder-defaults] dedicated column unavailable:",
      columnError,
    );
  }

  const hasFallback = Object.hasOwn(
    firm.business_hours ?? {},
    "default_reminder_settings",
  );
  if (hasFallback) {
    try {
      await updateCurrentFirm({
        business_hours: withReminderDefaultFallback(firm.business_hours, null),
      });
    } catch (fallbackError) {
      console.error(
        "[DELETE /api/firm/reminder-defaults] compatibility update failed:",
        fallbackError,
      );
      const detail =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      return NextResponse.json(
        { error: "update_failed", detail },
        { status: 500 },
      );
    }
  } else if (!columnRemoved) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
