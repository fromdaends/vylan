import { formatMinutes } from "@/lib/time/duration";

// The arithmetic behind the Time page: which days a view covers, which entries
// land on which day, and what the totals come to.
//
// Pure, and separate from the components, because every one of these is a
// question with a wrong answer that looks right on screen — a week that starts
// on Sunday, a month grid missing its trailing days, a total that forgets the
// timer that is still running.
//
// ── DAYS ARE STRINGS, NOT DATES ────────────────────────────────────────────
//
// "2026-08-06", the firm's own day, computed once by the caller from the firm
// timezone. A Date here would drag the browser's zone in and put an entry
// logged at 9pm Montreal onto tomorrow for anybody whose laptop says UTC.

export type TimeView = "day" | "week" | "month";

/** What the page renders: an entry, already reduced to what a card needs. */
export type TimeCard = {
  id: string;
  /** Firm-day this entry belongs to. */
  day: string;
  clientName: string | null;
  /** The engagement title, or the note — whatever names the work. */
  task: string | null;
  minutes: number;
  /** Minutes from midnight, for the day view's block position. Null when the
   *  entry carries no meaningful clock time (a manual entry lands at noon). */
  startMinute: number | null;
  /** A running timer. Exactly one of these can exist per person. */
  running: boolean;
  /** When it started, ISO. Present on the running entry only — the page
   *  derives its live seconds from this rather than counting up, so a laptop
   *  that slept for an hour shows the hour instead of the ticks it missed. */
  startedAtIso?: string;
};

/** ISO day, `n` days from `day`. String in, string out — no Date escapes. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  // UTC so the arithmetic cannot be bent by the runner's own offset; only the
  // calendar matters here, never the clock.
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Monday of the week containing `day`. ISO weeks, so the grid starts Monday
 *  and "the week" means the same thing to everyone in the firm. */
export function startOfWeek(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const backToMonday = (dow + 6) % 7;
  return addDays(day, -backToMonday);
}

export function startOfMonth(day: string): string {
  return day.slice(0, 8) + "01";
}

/** The seven days of the week containing `day`, Monday first. */
export function weekDays(day: string): string[] {
  const monday = startOfWeek(day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * The 42 cells of a month grid: the month, padded with the days either side so
 * every row is a full week.
 *
 * Always 42, never 35 — a five-row grid that grows to six on a long month
 * makes the page jump by a row as you page through the year.
 */
export function monthCells(day: string): string[] {
  const first = startOfMonth(day);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** Which days a view covers — the range to fetch, and the cells to draw. */
export function daysForView(view: TimeView, anchor: string): string[] {
  if (view === "day") return [anchor];
  if (view === "week") return weekDays(anchor);
  return monthCells(anchor);
}

/** Paging: one day, one week, or one month at a time. */
export function shiftAnchor(
  view: TimeView,
  anchor: string,
  direction: -1 | 1,
): string {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split("-").map(Number);
  // Clamped to the 1st: stepping from the 31st must not skip February.
  const shifted = new Date(Date.UTC(y, m - 1 + direction, 1));
  return shifted.toISOString().slice(0, 10);
}

/** Entries by day. Days with nothing simply do not appear — the caller draws
 *  its own empty state, which says more than an empty array would. */
export function groupByDay(cards: TimeCard[]): Map<string, TimeCard[]> {
  const out = new Map<string, TimeCard[]>();
  for (const c of cards) {
    const list = out.get(c.day) ?? [];
    list.push(c);
    out.set(c.day, list);
  }
  // The running timer sits FIRST in its day, per the handoff — it is the thing
  // happening now, and burying it under this morning's finished work would
  // make you hunt for the Stop button.
  for (const list of out.values()) {
    list.sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      return (a.startMinute ?? 0) - (b.startMinute ?? 0);
    });
  }
  return out;
}

/**
 * Total minutes across a set of days.
 *
 * `runningExtraSeconds` is what the live timer has added since its stored
 * minutes were written. The handoff is explicit that totals include the running
 * timer and tick with it — a week total that ignored the clock currently
 * running would be wrong by exactly the thing you are watching.
 */
export function totalMinutes(
  cards: TimeCard[],
  days?: Set<string>,
  runningExtraSeconds = 0,
): number {
  let total = 0;
  let hasRunning = false;
  for (const c of cards) {
    if (days && !days.has(c.day)) continue;
    total += c.minutes;
    if (c.running) hasRunning = true;
  }
  // Only when the running entry is actually inside the range being totalled.
  if (hasRunning) total += runningExtraSeconds / 60;
  return total;
}

/** "3h 40m", or an em dash for a day with nothing on it. A zero total is not
 *  "0m" here: a day you did not work is blank, not a day you worked none. */
export function formatDayTotal(minutes: number): string {
  return minutes <= 0 ? "—" : formatMinutes(Math.round(minutes));
}
