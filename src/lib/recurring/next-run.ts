// "What happens next" for one schedule.
//
// This is the most important cell on the Repeating work screen, and the one
// most easily made into a lie. Two traps it exists to avoid:
//
//  1. A PAUSED series keeps its old next_spawn_on — pauseSeriesAction never
//     touches the date. So a paused row's stored date is usually in the PAST.
//     Rendering it would tell you work is coming that will never come.
//  2. next_spawn_on is a firm-local calendar DATE, not a timestamp. Doing the
//     arithmetic with JS Date objects shifts it a day either side of UTC. All
//     the maths here goes through parseIsoDate / LocalDate, exactly like the
//     spawner, so this can never disagree with what actually spawns.
//
// Returns a discriminated union, not a string: the tone (is this urgent?) is a
// rendering decision and belongs in the component, not baked into copy.

import { parseIsoDate, type LocalDate, type RecurringSeriesStatus } from "./schedule";

export type NextRun =
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "in_days"; days: number }
  | { kind: "on_date"; date: string }
  // A running series whose date has passed. The cron is hourly, so this is a
  // brief window, not a fault — never render it as an error.
  | { kind: "due_now" }
  | { kind: "paused" }
  | { kind: "stopped" }
  // next_spawn_on unparseable. Shouldn't happen (the column is a NOT NULL
  // date) but a malformed value must not crash a whole list.
  | { kind: "unknown" };

// Days between two calendar dates, via UTC midnight so no timezone or DST
// shift can move the count. Both inputs are already firm-local.
function daysBetween(from: LocalDate, to: LocalDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

export function nextRunLabel(input: {
  nextSpawnOn: string;
  today: LocalDate;
  status: RecurringSeriesStatus;
}): NextRun {
  if (input.status === "ended") return { kind: "stopped" };
  // Deliberately BEFORE parsing: a paused series' date is meaningless, so we
  // never even look at it.
  if (input.status === "paused") return { kind: "paused" };

  const next = parseIsoDate(input.nextSpawnOn);
  if (!next) return { kind: "unknown" };

  const days = daysBetween(input.today, next);
  if (days < 0) return { kind: "due_now" };
  if (days === 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  // Past a week, a countdown stops being useful and a date starts being
  // useful — "in 47 days" is not something anyone plans around.
  if (days <= 7) return { kind: "in_days", days };
  return { kind: "on_date", date: input.nextSpawnOn };
}

// Whether this needs to catch the eye. Only "now-ish" states qualify — a
// schedule running normally must never be styled as a problem.
export function nextRunIsImminent(n: NextRun): boolean {
  return n.kind === "today" || n.kind === "tomorrow" || n.kind === "due_now";
}
