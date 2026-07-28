// Plain-English descriptions of a schedule's rhythm.
//
// A series stores its rhythm as THREE columns — frequency, interval_months,
// anchor_day — none of which mean anything on their own. "15" is not a fact
// anyone can read; "Monthly, on the 15th" is. These functions collapse the
// three into one sentence.
//
// They return an i18n KEY PLUS PARAMS, never a baked string, so the module
// stays locale-free and unit-testable. The caller does the translating.

import type { RecurringFrequency } from "./schedule";

export type CopySpec = {
  key: string;
  params: Record<string, string | number>;
};

// "Monthly, on the 15th" / "Quarterly, on the 1st" / "Yearly, on the 30th" /
// "Every 2 months, on the 1st".
//
// The anchor day is carried as a NUMBER, not a pre-formatted ordinal: French
// wants "1er" for the first and plain digits after, which is `ordinalDay`'s
// job, and doing it here would bake a locale into a pure module.
export function scheduleSentence(input: {
  frequency: RecurringFrequency;
  intervalMonths?: number | null;
  anchorDay: number;
}): CopySpec {
  const { frequency, intervalMonths, anchorDay } = input;

  if (frequency === "custom") {
    // A custom series without an interval is a DB-level impossibility (0890
    // has a CHECK), but a pre-0890 read can still hand us null. Fall back to
    // monthly wording rather than rendering "Every null months".
    const months = intervalMonths ?? 1;
    return {
      key: "repeats_custom_on",
      params: { months, day: anchorDay },
    };
  }

  return {
    key:
      frequency === "monthly"
        ? "repeats_monthly_on"
        : frequency === "quarterly"
          ? "repeats_quarterly_on"
          : "repeats_yearly_on",
    params: { day: anchorDay },
  };
}

// "Each one is due 15 days after it opens."
export function dueSentence(dueOffsetDays: number): CopySpec {
  return { key: "due_offset", params: { days: dueOffsetDays } };
}

// True when the anchor day doesn't exist in every month — the spawner clamps
// to the last day of a short month, which is worth saying out loud rather than
// letting someone wonder why February landed on the 28th.
export function anchorNeedsShortMonthNote(anchorDay: number): boolean {
  return anchorDay > 28;
}
