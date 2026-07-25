"use server";

// Owner-only "Reset stats" action for the Performance page. Sets (or clears) the
// firm's `performance_reset_at` baseline via the service role — the same pattern
// as the team/firm settings in team.ts (owner check is the gate; firm-scoped
// write, so no column grant is needed). Wholly NON-DESTRUCTIVE: it only moves a
// timestamp. Setting it makes the page count from now on; clearing it (undo)
// restores the full history.

import { revalidatePath } from "next/cache";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { logUserActivity } from "@/lib/db/activity";

export type PerfResetResult =
  | { ok: true }
  | {
      ok: false;
      // "unavailable" = migration 0880 not applied yet (column missing).
      error: "no_session" | "owner_only" | "unavailable" | "update_failed";
    };

// Owner-only. Writes the firm's performance-reset baseline (an ISO instant to
// set it, or null to clear it). Fail-open with "unavailable" if 0880 hasn't been
// applied, so the page never hard-errors on an un-migrated DB.
async function writePerformanceResetAt(
  value: string | null,
): Promise<PerfResetResult> {
  const [me, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!me || !firm) return { ok: false, error: "no_session" };
  if (me.role !== "owner") return { ok: false, error: "owner_only" };

  const admin = getServiceRoleSupabase();
  const { error } = await admin
    .from("firms")
    .update({ performance_reset_at: value })
    .eq("id", firm.id);
  if (error) {
    if (error.code === "PGRST204" || error.code === "42703") {
      return { ok: false, error: "unavailable" };
    }
    console.error("[performance] writePerformanceResetAt failed:", error.message);
    return { ok: false, error: "update_failed" };
  }

  await logUserActivity(firm.id, null, "firm_settings_changed", {
    setting: "performance_reset_at",
    value,
  });
  revalidatePath("/performance");
  return { ok: true };
}

// Start the stats fresh from now. Historical records are untouched — they're
// just excluded from the Performance totals before this instant.
export async function resetPerformanceStats(): Promise<PerfResetResult> {
  return writePerformanceResetAt(new Date().toISOString());
}

// Undo a previous reset: clears the baseline so the full history shows again.
export async function undoPerformanceReset(): Promise<PerfResetResult> {
  return writePerformanceResetAt(null);
}
