// Due-date arithmetic for tasks — the ONE place "overdue", "today" and "this
// week" are decided, so the dashboard's stats strip, its grouped Tasks card and
// /work's filters can never disagree about which bucket a task is in.
//
// Everything here works on PLAIN DATE STRINGS (YYYY-MM-DD). due_date is a
// Postgres `date` with no timezone, and the server renders in UTC where "today"
// is already tomorrow during a Quebec evening — so "today" is always computed
// in the FIRM's timezone and passed down, never read from the machine clock at
// comparison time.
//
// "This week" runs Monday through Sunday and INCLUDES today: on the approved
// mock (a Monday), "due this week" counts the task due today plus the two due
// Wednesday and Thursday. A task due next Monday is "later".
//
// Pure and framework-free, so every rule in here is directly testable.

export type DueBucket = "overdue" | "today" | "week" | "later";

export type DueDatedTask = {
  status: "todo" | "doing" | "done";
  dueDate: string | null;
  completedAt: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar date where the firm lives, as YYYY-MM-DD. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the string we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The calendar date (in the given timezone) of an ISO timestamp. */
export function dateInTimeZone(iso: string, timeZone: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return todayInTimeZone(timeZone, d);
}

/** Parse YYYY-MM-DD to a UTC-noon Date — noon so DST shifts can never move it
 *  across a day boundary in either direction. Null for anything malformed. */
function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  if (!d) return day;
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** The Sunday that ends today's Monday-start week. */
export function endOfWeek(today: string): string {
  const d = parseDay(today);
  if (!d) return today;
  const dow = d.getUTCDay(); // Sun=0 … Sat=6
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  return addDays(today, daysToSunday);
}

export function bucketForDueDate(
  dueDate: string | null,
  today: string,
): DueBucket {
  if (!dueDate || !parseDay(dueDate)) return "later";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate <= endOfWeek(today)) return "week";
  return "later";
}

export type TaskGroups<T> = {
  overdue: T[];
  today: T[];
  week: T[];
  later: T[];
  doneToday: T[];
};

/**
 * The dashboard card's five groups. Done tasks appear ONLY under "Done today"
 * (finished on today's date in the firm's timezone) — yesterday's finished
 * work is history, not dashboard material. Open groups sort soonest-due first
 * (most overdue first), with undated tasks keeping their list order at the end
 * of "later".
 */
export function groupTasks<T extends DueDatedTask>(
  tasks: T[],
  today: string,
  timeZone: string,
): TaskGroups<T> {
  const groups: TaskGroups<T> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    doneToday: [],
  };
  for (const task of tasks) {
    if (task.status === "done") {
      if (
        task.completedAt &&
        dateInTimeZone(task.completedAt, timeZone) === today
      ) {
        groups.doneToday.push(task);
      }
      continue;
    }
    groups[bucketForDueDate(task.dueDate, today)].push(task);
  }
  const byDue = (a: T, b: T) => {
    if (a.dueDate === b.dueDate) return 0;
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  };
  groups.overdue.sort(byDue);
  groups.week.sort(byDue);
  groups.later.sort(byDue);
  return groups;
}

export type TaskStats = {
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  open: number;
};

/** The stats strip's four counts. "Due this week" includes today — it answers
 *  "what does this week hold", not "what is left after today". Done tasks
 *  count nowhere. */
export function taskStats(tasks: DueDatedTask[], today: string): TaskStats {
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let open = 0;
  for (const task of tasks) {
    if (task.status === "done") continue;
    open += 1;
    const bucket = bucketForDueDate(task.dueDate, today);
    if (bucket === "overdue") overdue += 1;
    if (bucket === "today") {
      dueToday += 1;
      dueThisWeek += 1;
    }
    if (bucket === "week") dueThisWeek += 1;
  }
  return { overdue, dueToday, dueThisWeek, open };
}

export type DueFilter = "overdue" | "today" | "week";

export function toDueFilter(v: unknown): DueFilter | null {
  return v === "overdue" || v === "today" || v === "week" ? v : null;
}

/** /work's due-date filter — the same buckets the stats strip links to.
 *  "week" means the whole strip cell: due this week INCLUDING today. */
export function matchesDueFilter(
  task: DueDatedTask,
  filter: DueFilter,
  today: string,
): boolean {
  if (task.status === "done") return false;
  const bucket = bucketForDueDate(task.dueDate, today);
  if (filter === "overdue") return bucket === "overdue";
  if (filter === "today") return bucket === "today";
  return bucket === "today" || bucket === "week";
}

/** "Wed, Aug 5" / "mer. 5 août" — the plain upcoming-due label. */
export function formatDueWeekday(day: string, locale: string): string {
  const d = parseDay(day);
  if (!d) return day;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** "Jul 30" / "30 juil." — the date half of the overdue pill. */
export function formatDueShort(day: string, locale: string): string {
  const d = parseDay(day);
  if (!d) return day;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}
