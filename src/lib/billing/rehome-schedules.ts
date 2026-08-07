// Keep a payment arrangement alive when the occurrence it was born on dies.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// engagement_billing_schedules.engagement_id is `on delete cascade` (1710),
// and engagement_billing_charges cascades off the schedule. That was exactly
// right while a schedule belonged to the single engagement it billed: deleting
// the engagement ended the arrangement, because the engagement WAS the
// arrangement.
//
// It stopped being right the moment work-repeat and pay-repeat became
// independent (founder ruling): an annual job paid monthly keeps ONE schedule
// across every occurrence, and that schedule is pinned to whichever occurrence
// happened to create it — usually last year's, now finished and eventually
// purged. Purging it would silently delete the whole arrangement's billing AND
// its charge ledger: the client simply stops being charged, with no error, no
// log line, and nothing on screen. Up to a year could pass before the next
// occurrence noticed.
//
// So before an engagement is hard-deleted, any non-ended schedule it carries
// moves to a surviving occurrence of the same series. Nothing else about the
// schedule changes — same frequency, same anchor day, same next charge date,
// same ledger — so the client's payments continue uninterrupted.
//
// When no occurrence survives, the arrangement really is over: the schedule is
// ENDED rather than re-homed, which stops future charges while keeping the
// row (and its history) instead of cascading it into nothing.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type RehomeOutcome = {
  /** Schedules moved to a surviving occurrence. */
  moved: number;
  /** Schedules ended because the series had nobody left to bill from. */
  ended: number;
};

/**
 * Re-home (or end) the billing schedules attached to an engagement that is
 * about to be permanently deleted.
 *
 * Best-effort and never throws: a purge must not fail because of this, and a
 * schedule left in place is caught by the cascade — which is the behaviour
 * that existed before this function, not a new hazard.
 */
export async function rehomeSchedulesBeforeDelete(
  engagementId: string,
): Promise<RehomeOutcome> {
  const out: RehomeOutcome = { moved: 0, ended: 0 };
  try {
    // INSIDE the try: constructing the service-role client throws when the
    // key is absent, and a purge must never fail because of this helper —
    // the cascade then applies, which is the behaviour that predates it.
    const sb = getServiceRoleSupabase();
    const { data: scheds, error: schedErr } = await sb
      .from("engagement_billing_schedules")
      .select("id, frequency")
      .eq("engagement_id", engagementId)
      .neq("status", "ended");
    if (schedErr) {
      // Pre-1710 there are no schedules at all; anything else is logged and
      // left to the cascade, exactly as before this existed.
      if (!isMissingSchema(schedErr)) {
        console.error("[rehome-schedules] read failed:", schedErr);
      }
      return out;
    }
    if (!scheds || scheds.length === 0) return out;

    // Which series does this engagement belong to, and who else is in it?
    const { data: engRow } = await sb
      .from("engagements")
      .select("series_id")
      .eq("id", engagementId)
      .maybeSingle();
    const seriesId = (engRow as { series_id?: string | null } | null)
      ?.series_id;

    let heir: string | null = null;
    if (seriesId) {
      // Prefer the newest surviving occurrence: it holds the current prices
      // and the title the client is seeing now.
      const { data: siblings } = await sb
        .from("engagements")
        .select("id, created_at, deleted_at")
        .eq("series_id", seriesId)
        .neq("id", engagementId)
        .order("created_at", { ascending: false });
      const alive = (siblings ?? []).filter(
        (s) => (s as { deleted_at: string | null }).deleted_at == null,
      );
      heir = (alive[0] as { id: string } | undefined)?.id ?? null;
    }

    for (const s of scheds) {
      const id = (s as { id: string }).id;
      if (heir) {
        const { error } = await sb
          .from("engagement_billing_schedules")
          .update({ engagement_id: heir })
          .eq("id", id);
        if (error) {
          console.error("[rehome-schedules] move failed:", error);
          continue;
        }
        out.moved += 1;
      } else {
        // Nobody left to bill from. End it rather than let the cascade take
        // the row and its charge history with the engagement.
        const { error } = await sb
          .from("engagement_billing_schedules")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", id);
        if (error) {
          console.error("[rehome-schedules] end failed:", error);
          continue;
        }
        out.ended += 1;
      }
    }
  } catch (e) {
    console.error("[rehome-schedules] failed:", e);
  }
  return out;
}
