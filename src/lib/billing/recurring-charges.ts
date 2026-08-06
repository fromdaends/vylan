// When a recurring service line actually gets billed. Pure calendar math, no I/O.
//
// ── THE PROMISE THIS KEEPS ─────────────────────────────────────────────────
//
// A billing block can say "$400/month" (billing-blocks.ts), the totals panel
// groups by frequency, and the client's proposal prints "$400 monthly". Until
// now that sentence was decoration in exactly the way the deposit was before
// 1680: `engagement_items.billing_frequency` was read for DISPLAY only, and the
// engagement was invoiced ONCE. A client could agree to pay monthly and never
// be asked for the second month.
//
// This is the schedule that makes it true.
//
// ── WHY NOT src/lib/recurring/schedule.ts ──────────────────────────────────
//
// That module schedules WORK and this one schedules MONEY, and they differ on
// the one question that matters most:
//
//   resolveDueSpawn() SKIPS missed periods. A week of downtime produces one
//   engagement, not seven — right, because nobody wants seven copies of the
//   same document request landing at once.
//
//   resolveDueCharge() NEVER skips. It advances exactly ONE cycle per call, so
//   a backlog drains one period per run (hourly) instead of being forgotten. A
//   skipped work request is a duplicate avoided; a skipped charge is revenue
//   the firm silently never billed, and nothing downstream would ever notice.
//
// It also has to handle WEEKLY, which the engagement spawner does not offer
// (BLOCK_FREQUENCIES vs RECURRING_FREQUENCIES) and which is day arithmetic
// rather than month arithmetic.
//
// Everything the two DO agree on — firm-local calendar dates carried as plain
// {year,month,day} parts so no JS Date timezone behaviour can leak in, anchor
// days clamped to short months, a period key that the database makes unique —
// is imported from there rather than written twice.

import {
  compareLocalDates,
  daysInMonth,
  type LocalDate,
} from "@/lib/recurring/schedule";

/** The repeats a billing block can carry. Mirrors BLOCK_FREQUENCIES exactly —
 *  a block that bills once is not on a schedule at all. */
export const CHARGE_FREQUENCIES = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type ChargeFrequency = (typeof CHARGE_FREQUENCIES)[number];

export function isChargeFrequency(v: unknown): v is ChargeFrequency {
  return (
    v === "weekly" || v === "monthly" || v === "quarterly" || v === "yearly"
  );
}

/** How many months one cycle spans. Weekly is not months — see nextChargeDate. */
const CYCLE_MONTHS: Record<Exclude<ChargeFrequency, "weekly">, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * The next date this schedule charges on, exactly one cycle after `from`.
 *
 * The anchor day is re-applied from the SCHEDULE each time and clamped to the
 * target month, never derived from the previous (possibly clamped) date — so a
 * day-31 monthly schedule runs Jan 31 → Feb 28 → Mar 31 rather than sticking on
 * the 28th forever. Same rule as nextSpawn(), and for the same reason.
 *
 * Weekly ignores the anchor day entirely: it is +7 days, which preserves the
 * weekday the schedule started on without any month to clamp against.
 */
export function nextChargeDate(
  from: LocalDate,
  frequency: ChargeFrequency,
  anchorDay: number,
): LocalDate {
  if (frequency === "weekly") return addDays(from, 7);
  const totalMonths = from.month - 1 + CYCLE_MONTHS[frequency];
  const year = from.year + Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const day = Math.min(Math.max(anchorDay, 1), daysInMonth(year, month));
  return { year, month, day };
}

function addDays(d: LocalDate, days: number): LocalDate {
  const dt = new Date(Date.UTC(d.year, d.month - 1, d.day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/**
 * The period a charge belongs to — the ledger key, made unique by the database.
 *
 * One key per billable period, so a retry, an overlapping cron run and a manual
 * "charge now" can all target the same period and only the first can win.
 *
 * Weekly uses an ISO-8601 week key (`2026-W32`) rather than the date, so two
 * runs a day apart inside the same week resolve to the same period. Using the
 * raw date would make every day its own period the moment a schedule drifted.
 */
export function chargePeriodKey(
  frequency: ChargeFrequency,
  d: LocalDate,
): string {
  if (frequency === "weekly") {
    const { year, week } = isoWeek(d);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  if (frequency === "monthly") {
    return `${d.year}-${String(d.month).padStart(2, "0")}`;
  }
  if (frequency === "quarterly") {
    return `${d.year}-Q${Math.ceil(d.month / 3)}`;
  }
  return String(d.year);
}

/**
 * ISO-8601 week number and its week-year.
 *
 * The week-year is NOT always the calendar year: 2027-01-01 is a Friday and
 * belongs to week 53 of 2026. Keying on the calendar year would put two
 * different weeks under `2027-W53`/`2026-W53` and let one of them bill twice.
 */
function isoWeek(d: LocalDate): { year: number; week: number } {
  // Thursday of this week decides the week-year, by definition.
  const dt = new Date(Date.UTC(d.year, d.month - 1, d.day));
  const dayNum = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay(); // Mon=1..Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const weekYear = dt.getUTCFullYear();
  const jan1 = new Date(Date.UTC(weekYear, 0, 1));
  const week =
    Math.floor((dt.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1;
  return { year: weekYear, week };
}

export type DueCharge = {
  /** The scheduled date of the period being billed. */
  chargeDate: LocalDate;
  /** Its ledger key. UNIQUE(schedule_id, period_key) at the database. */
  periodKey: string;
  /** What `next_charge_on` becomes after this one — exactly one cycle later,
   *  which may still be in the past when a backlog is draining. */
  nextChargeOn: LocalDate;
};

/**
 * Should this schedule bill right now, and for which period?
 *
 * ONE period per call, always the OLDEST outstanding one, and the schedule
 * advances by exactly one cycle. Three consequences, all deliberate:
 *
 *   * A backlog drains in order — a firm that was three months unbilled gets
 *     March, then April, then May, each its own invoice with its own period on
 *     it, rather than one merged charge nobody can reconcile.
 *   * It drains at one period per run. The cron is hourly, so three missed
 *     months are caught up within three hours and the client is never hit with
 *     three invoices in the same second.
 *   * Nothing is ever silently dropped, which is the whole difference between
 *     scheduling money and scheduling work.
 */
export function resolveDueCharge(opts: {
  nextChargeOn: LocalDate;
  frequency: ChargeFrequency;
  anchorDay: number;
  today: LocalDate;
  /** Stop billing after this date, when the arrangement has an end. */
  endsOn?: LocalDate | null;
}): DueCharge | null {
  if (compareLocalDates(opts.nextChargeOn, opts.today) > 0) return null;
  if (opts.endsOn && compareLocalDates(opts.nextChargeOn, opts.endsOn) > 0) {
    return null;
  }
  return {
    chargeDate: opts.nextChargeOn,
    periodKey: chargePeriodKey(opts.frequency, opts.nextChargeOn),
    nextChargeOn: nextChargeDate(
      opts.nextChargeOn,
      opts.frequency,
      opts.anchorDay,
    ),
  };
}

/**
 * A human label for the period, for the invoice's own description.
 *
 * An invoice that just says "Monthly bookkeeping" three times in a row is
 * unreconcilable; "Monthly bookkeeping — 2026-08" is not. The key itself is
 * already the clearest thing available and is what the ledger stores, so it is
 * what the client sees too — no second vocabulary to keep in step.
 */
export function chargeDescription(
  base: string,
  periodKey: string,
): string {
  const name = base.trim();
  return name.length > 0 ? `${name} — ${periodKey}` : periodKey;
}
