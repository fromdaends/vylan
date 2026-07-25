// Turn Repeat on (or update it) for an engagement — the ONE code path shared
// by the engagement builder ("create with repeat") and the engagement page's
// Repeat dialog, so the two can never diverge on scheduling rules.
//
// Runs RLS-scoped (the accountant's session). The Phase 2 spawner is separate
// (service role) but reuses the same pure schedule math.

import type { Engagement } from "@/lib/db/engagements";
import type { TemplateItem } from "@/lib/db/templates";
import { normalizeReminderSettings } from "@/lib/reminder-settings";
import {
  createRecurringSeries,
  getRecurringSeries,
  updateRecurringSeries,
  recordOccurrence,
  linkEngagementToSeries,
  type RecurringSeries,
} from "@/lib/db/recurring";
import {
  clampAnchorDay,
  clampIntervalMonths,
  localToday,
  nextSpawn,
  periodKeyFor,
  toIsoDate,
  type RecurringFrequency,
} from "./schedule";

export type ApplyRepeatInput = {
  engagement: Pick<
    Engagement,
    | "id"
    | "firm_id"
    | "client_id"
    | "title"
    | "type"
    | "ai_enabled"
    | "reminder_settings"
    | "series_id"
  >;
  firmTimezone: string;
  userId: string | null;
  frequency: RecurringFrequency;
  // Custom schedules only ("every N months"). Ignored for the fixed
  // frequencies, which derive their cycle from `frequency`.
  intervalMonths?: number | null;
  // Custom schedules only: the day-of-month the accountant chose. The fixed
  // frequencies keep their existing behaviour (anchor = the day repeat was
  // switched on).
  anchorDay?: number | null;
  dueOffsetDays: number;
  // The checklist snapshot future occurrences will copy (collection items
  // only — see src/lib/recurring/snapshot.ts).
  itemsSnapshot: TemplateItem[];
  // Invoice recurrence (Phase 4), builder path only: when set, the new series
  // stores it. The engagement-page path manages it via its own switch action.
  invoice?: {
    recreate: boolean;
    snapshot: Record<string, unknown> | null;
  };
};

// Enable repeat, or update the schedule of the engagement's existing series.
// Throws on real failures (callers decide best-effort vs surfaced error).
export async function applyRepeatChoice(
  input: ApplyRepeatInput,
): Promise<{ seriesId: string }> {
  const today = localToday(input.firmTimezone);

  // Already in a series -> edit-future: patch the series row only. Existing
  // engagements are independent copies and are structurally unreachable here.
  const existing: RecurringSeries | null = input.engagement.series_id
    ? await getRecurringSeries(input.engagement.series_id)
    : null;
  if (existing) {
    // A custom series carries its own cycle length + chosen day; the fixed
    // frequencies keep the series' existing anchor and clear the interval.
    const isCustom = input.frequency === "custom";
    const intervalMonths = isCustom
      ? clampIntervalMonths(input.intervalMonths)
      : null;
    const anchorDay =
      isCustom && input.anchorDay != null
        ? clampAnchorDay(input.anchorDay)
        : existing.anchor_day;

    const frequencyChanged = existing.frequency !== input.frequency;
    // Editing "every 2 months" to "every 3 months", or moving the day, is just
    // as much a schedule change as switching frequency — all of them must
    // re-anchor, or the next occurrence would still land on the old schedule.
    const cycleChanged =
      (existing.interval_months ?? null) !== intervalMonths ||
      existing.anchor_day !== anchorDay;
    const reactivating = existing.status !== "active";
    await updateRecurringSeries(existing.id, {
      frequency: input.frequency,
      interval_months: intervalMonths,
      anchor_day: anchorDay,
      due_offset_days: input.dueOffsetDays,
      // Forward-only, always: a schedule change re-anchors from today, and a
      // paused/ended series resumed later NEVER backfills missed cycles — it
      // picks up at the next future cycle from now.
      ...(frequencyChanged || cycleChanged || reactivating
        ? {
            next_spawn_on: toIsoDate(
              nextSpawn(today, input.frequency, anchorDay, intervalMonths),
            ),
          }
        : {}),
      ...(reactivating
        ? { status: "active" as const, paused_at: null, ended_at: null }
        : {}),
    });
    return { seriesId: existing.id };
  }

  // New series. For the fixed frequencies the anchor is the day-of-month repeat
  // is enabled (clamped to short months at each spawn), so "set up on the 12th"
  // means "spawns on the 12th". A custom schedule uses the day the accountant
  // picked instead.
  const isCustom = input.frequency === "custom";
  const intervalMonths = isCustom
    ? clampIntervalMonths(input.intervalMonths)
    : null;
  const anchorDay =
    isCustom && input.anchorDay != null
      ? clampAnchorDay(input.anchorDay)
      : today.day;
  const series = await createRecurringSeries({
    firm_id: input.engagement.firm_id,
    client_id: input.engagement.client_id,
    source_engagement_id: input.engagement.id,
    title: input.engagement.title,
    type: input.engagement.type,
    frequency: input.frequency,
    interval_months: intervalMonths,
    anchor_day: anchorDay,
    due_offset_days: input.dueOffsetDays,
    items: input.itemsSnapshot,
    ai_enabled: input.engagement.ai_enabled !== false,
    reminder_settings: normalizeReminderSettings(
      input.engagement.reminder_settings,
    ),
    next_spawn_on: toIsoDate(
      nextSpawn(today, input.frequency, anchorDay, intervalMonths),
    ),
    created_by_user_id: input.userId,
    // Recreate is stored ONLY with a usable snapshot; the switch without an
    // invoice to copy would spawn nothing anyway.
    invoice_recreate:
      input.invoice?.recreate === true && input.invoice.snapshot != null,
    invoice_snapshot: input.invoice?.snapshot ?? null,
  });

  // Ledger the CURRENT period as this engagement, so the spawner can never
  // create a second occurrence for the period the accountant just set up.
  // "duplicate" here would mean a concurrent enable already ledgered it —
  // equally fine, the guarantee held.
  await recordOccurrence({
    series_id: series.id,
    firm_id: input.engagement.firm_id,
    period_key: periodKeyFor(input.frequency, today),
    engagement_id: input.engagement.id,
  });

  // Stamp the engagement (badge + series panel). Failure here is surfaced —
  // without the link the accountant would see Repeat as "off" and re-enabling
  // would create a second series.
  await linkEngagementToSeries(
    input.engagement.id,
    series.id,
    periodKeyFor(input.frequency, today),
  );

  return { seriesId: series.id };
}
