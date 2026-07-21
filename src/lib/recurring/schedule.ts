// Pure calendar math for recurring engagements: period keys, next-spawn
// computation, and due-date offsets. No I/O — everything here is unit-tested
// without a database, and both the accountant-facing actions and the Phase 2
// spawner share these exact rules so they can never disagree.
//
// All dates are FIRM-LOCAL calendar dates (the firm's IANA timezone, e.g.
// America/Toronto): "the 1st of the month" means the 1st for the firm, not
// the 1st in UTC. We carry them as plain {year, month, day} parts precisely
// so no JS Date timezone behavior can leak in.

export type RecurringFrequency = "monthly" | "quarterly" | "yearly";

export type RecurringSeriesStatus = "active" | "paused" | "ended";

// A firm-local calendar date. month is 1-12 (human, not JS Date's 0-11).
export type LocalDate = { year: number; month: number; day: number };

export const RECURRING_FREQUENCIES: RecurringFrequency[] = [
  "monthly",
  "quarterly",
  "yearly",
];

// Cycle length in months.
const FREQUENCY_MONTHS: Record<RecurringFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

export function isRecurringFrequency(v: unknown): v is RecurringFrequency {
  return v === "monthly" || v === "quarterly" || v === "yearly";
}

// Today as the firm sees it. Intl with an IANA zone is the one reliable way
// to get a local calendar date server-side; en-CA formats as YYYY-MM-DD.
// Falls back to UTC parts on a bad/unknown timezone rather than throwing —
// a mis-set firm timezone should shift spawn timing by hours, not break it.
export function localToday(timeZone: string, now: Date = new Date()): LocalDate {
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const [year, month, day] = formatted.split("-").map(Number);
    if (year && month && day) return { year, month, day };
  } catch {
    // Unknown timezone string — fall through to UTC.
  }
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month = last day of this month. UTC so DST can't exist.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Advance a spawn date by one cycle, re-applying the series' anchor day and
// clamping to short months: a day-31 monthly series spawns Jan 31 -> Feb 28
// (29 in leap years) -> Mar 31. The anchor is stored on the series, never
// derived from the (possibly clamped) previous spawn, so clamping never
// "sticks".
export function nextSpawn(
  from: LocalDate,
  frequency: RecurringFrequency,
  anchorDay: number,
): LocalDate {
  const totalMonths = from.month - 1 + FREQUENCY_MONTHS[frequency];
  const year = from.year + Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return { year, month, day };
}

// The period a spawn date belongs to — the ledger key. One spawn per period
// per series, enforced by UNIQUE(series_id, period_key) in the database.
export function periodKeyFor(
  frequency: RecurringFrequency,
  d: LocalDate,
): string {
  if (frequency === "monthly") {
    return `${d.year}-${String(d.month).padStart(2, "0")}`;
  }
  if (frequency === "quarterly") {
    return `${d.year}-Q${Math.ceil(d.month / 3)}`;
  }
  return String(d.year);
}

export function toIsoDate(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(
    d.day,
  ).padStart(2, "0")}`;
}

export function parseIsoDate(iso: string): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

// Spawn date + offset -> the occurrence's due date (ISO date string, the
// format engagements.due_date already uses). UTC arithmetic on a date-only
// value — timezones were already resolved when the spawn date was computed.
export function dueDateFor(spawn: LocalDate, offsetDays: number): string {
  const dt = new Date(Date.UTC(spawn.year, spawn.month - 1, spawn.day));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

// Calendar comparison: -1 (a before b), 0 (same day), 1 (a after b).
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

export type DueSpawn = {
  // The scheduled date of the period being spawned — the LATEST scheduled
  // date that is <= today. Period key and due date both derive from it, so
  // an occurrence always belongs to its calendar period even if the cron ran
  // a few hours (or days) late.
  spawnDate: LocalDate;
  periodKey: string;
  // The first STRICTLY-FUTURE scheduled date — what the series' next_spawn_on
  // becomes after this spawn.
  nextSpawnOn: LocalDate;
};

// The spawner's one decision, pure and heavily tested: given a series'
// schedule and the firm-local today, what (if anything) should spawn?
//
//   * Not due yet -> null.
//   * Due -> exactly ONE spawn: the latest scheduled period <= today.
//     Periods missed during downtime or a pause are SKIPPED, never
//     backfilled — a week of downtime produces one occurrence per series,
//     not seven. next_spawn_on always lands strictly in the future, so a
//     series can never spawn twice in one day even across repeated runs
//     (and the occurrence ledger backstops that at the database).
export function resolveDueSpawn(opts: {
  nextSpawnOn: LocalDate;
  frequency: RecurringFrequency;
  anchorDay: number;
  today: LocalDate;
}): DueSpawn | null {
  if (compareLocalDates(opts.nextSpawnOn, opts.today) > 0) return null;
  let spawn = opts.nextSpawnOn;
  let next = nextSpawn(spawn, opts.frequency, opts.anchorDay);
  while (compareLocalDates(next, opts.today) <= 0) {
    spawn = next;
    next = nextSpawn(spawn, opts.frequency, opts.anchorDay);
  }
  return {
    spawnDate: spawn,
    periodKey: periodKeyFor(opts.frequency, spawn),
    nextSpawnOn: next,
  };
}
