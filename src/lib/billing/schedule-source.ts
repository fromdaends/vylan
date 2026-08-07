// WHICH engagement a payment schedule should read from, right now.
//
// A schedule is pinned to the engagement that created it. That is the whole
// truth for an ordinary arrangement — one engagement, one schedule, and the
// engagement is the arrangement.
//
// It is NOT the truth once the work repeats on its own cadence (founder
// ruling: an annual job may be paid monthly). Then one schedule spans a whole
// series while staying pinned to whichever occurrence opened it, and that
// occurrence goes stale: last year's job is completed, possibly cancelled,
// its prices are last year's prices, and its title carries last year's
// period. Charging from it means
//
//   * a re-price on the live occurrence never reaching the client,
//   * an invoice that says "Corporate return — 2026" every month of 2028,
//   * and, worst, ENDING the whole arrangement because somebody cancelled or
//     tidied the finished occurrence the schedule happened to point at.
//
// So: a schedule belonging to a series reads from the series' CURRENT live
// occurrence. The pinned engagement is only the fallback — and the fallback
// is what every non-series schedule uses, unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ScheduleSource = {
  /** The engagement to price, label and status-check this period against. */
  engagementId: string;
  /** True when it came from the series rather than the pinned row. */
  fromSeries: boolean;
  /** The series this schedule belongs to, when it belongs to one. */
  seriesId: string | null;
};

/**
 * Total and fail-soft: any unknown resolves to the pinned engagement, which
 * is exactly the behaviour that existed before series-spanning schedules.
 */
export async function resolveScheduleSource(
  sb: SupabaseClient,
  pinnedEngagementId: string,
): Promise<ScheduleSource> {
  const fallback: ScheduleSource = {
    engagementId: pinnedEngagementId,
    fromSeries: false,
    seriesId: null,
  };
  try {
    const { data: pinned, error } = await sb
      .from("engagements")
      .select("series_id")
      .eq("id", pinnedEngagementId)
      .maybeSingle();
    if (error) return fallback;
    const seriesId = (pinned as { series_id?: string | null } | null)
      ?.series_id;
    if (!seriesId) return fallback;

    // The newest occurrence that is still alive and not cancelled: the one
    // whose prices and title the client is actually looking at.
    const { data: rows } = await sb
      .from("engagements")
      .select("id, status, deleted_at, created_at")
      .eq("series_id", seriesId)
      .order("created_at", { ascending: false });
    const live = (rows ?? []).find((r) => {
      const e = r as {
        status: string;
        deleted_at: string | null;
      };
      return (
        e.deleted_at == null &&
        e.status !== "cancelled" &&
        e.status !== "canceled"
      );
    }) as { id: string } | undefined;

    if (!live) {
      // Every occurrence is gone or cancelled — the arrangement really is
      // over, and the caller's own "engagement missing / cancelled" rule
      // should end it. Point at the pinned row so that rule fires.
      return { ...fallback, seriesId };
    }
    return {
      engagementId: live.id,
      fromSeries: live.id !== pinnedEngagementId,
      seriesId,
    };
  } catch {
    return fallback;
  }
}
