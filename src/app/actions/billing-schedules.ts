"use server";

// Stopping, pausing and resuming an ongoing billing arrangement.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// A "$400/month" line started billing for real (1710) and there was no way in
// the entire product to stop it. The only exits were deleting the engagement or
// archiving the client — neither of which is called "stop billing", and the
// second silently ended the revenue forever. A recurring charge you cannot
// switch off is worse than one that never ran.
//
// Only async exports live here: a `"use server"` module that exports anything
// else fails the production build, and only `next build` catches it.

import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/db/firms";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  setBillingScheduleStatusSR,
  type BillingScheduleStatus,
} from "@/lib/db/billing-schedules";

export type ScheduleActionResult = { ok: boolean; error?: string };

/**
 * Change one schedule's state.
 *
 * ── THE AUTHORISATION, SPELLED OUT ─────────────────────────────────────────
 *
 * The write is service-role (the cron owns these rows and there is no member
 * INSERT/UPDATE policy on the table), so RLS is NOT what protects it here. The
 * firm check below is. It reads the schedule's own firm_id and compares it to
 * the caller's session firm — never trusting a firm id from the caller — which
 * is the same shape every other service-role action in this repo uses.
 */
async function setStatus(
  scheduleId: string,
  status: BillingScheduleStatus,
): Promise<ScheduleActionResult> {
  if (typeof scheduleId !== "string" || scheduleId.length === 0) {
    return { ok: false, error: "not_found" };
  }

  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "not_authorized" };

  const sb = getServiceRoleSupabase();
  const { data } = await sb
    .from("engagement_billing_schedules")
    .select("id, firm_id, engagement_id, status")
    .eq("id", scheduleId)
    .maybeSingle();
  const schedule = data as {
    firm_id: string;
    engagement_id: string;
    status: BillingScheduleStatus;
  } | null;
  if (!schedule) return { ok: false, error: "not_found" };
  if (schedule.firm_id !== firm.id) return { ok: false, error: "not_authorized" };

  // Ended is final. Resuming a schedule whose engagement was cancelled, or whose
  // priced lines were deleted, would start billing for work that no longer
  // exists — and the charge runner would only end it again on the next run.
  if (schedule.status === "ended") {
    return { ok: false, error: "already_ended" };
  }

  await setBillingScheduleStatusSR(scheduleId, status);
  revalidatePath(`/engagements/${schedule.engagement_id}`);
  return { ok: true };
}

/** Stop billing for now. The schedule keeps its place and can be resumed. */
export async function pauseBillingScheduleAction(
  scheduleId: string,
): Promise<ScheduleActionResult> {
  return setStatus(scheduleId, "paused");
}

/**
 * Start billing again.
 *
 * NOTE ON THE MISSED PERIODS: resolveDueCharge never skips, so a schedule
 * resumed after two unbilled months will bill both — one per hourly run, oldest
 * first. That is deliberate for money and it is what a firm resuming a paused
 * arrangement almost always wants; a firm that does NOT want the back-months
 * should end this schedule rather than resume it.
 */
export async function resumeBillingScheduleAction(
  scheduleId: string,
): Promise<ScheduleActionResult> {
  return setStatus(scheduleId, "active");
}

/** Stop for good. Irreversible by design — see the `ended` guard above. */
export async function endBillingScheduleAction(
  scheduleId: string,
): Promise<ScheduleActionResult> {
  return setStatus(scheduleId, "ended");
}
