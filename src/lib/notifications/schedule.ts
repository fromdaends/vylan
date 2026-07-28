// Delivery timing for notification emails — quiet hours, weekend pause and
// digest windows. Every function here is PURE (time is always passed in, never
// read from the clock) so the whole ruleset is unit-testable without freezing
// time or standing up a database.
//
// Timezones are handled with the platform's own Intl APIs rather than a new
// dependency. `date-fns` is in the project but `date-fns-tz` is not, and
// Intl.DateTimeFormat already carries the full IANA database including DST
// history — adding a package to do what the runtime does natively would be
// weight for nothing.

export type EmailMode = "instant" | "hourly_digest" | "daily_digest";

export type DeliverySettings = {
  emailEnabled: boolean;
  emailMode: EmailMode;
  dailyDigestTime: string; // "HH:MM" or "HH:MM:SS"
  timezone: string; // IANA, e.g. "America/Toronto"
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  pauseWeekends: boolean;
};

export type DeferReason =
  | "quiet_hours"
  | "weekend"
  | "hourly_digest"
  | "daily_digest";

export type DeliveryDecision =
  | { kind: "send_now" }
  | { kind: "defer"; sendAfter: Date; reason: DeferReason }
  | { kind: "suppress"; reason: "email_disabled" };

// When a weekend pause lifts, deliver at the start of the business day rather
// than 00:00 Monday — a batch of email landing at midnight is worse than
// useless. Overridden by the user's own quiet-hours end / digest time when
// either is set, since those are explicit preferences and this is a default.
export const WEEKEND_RESUME_HOUR = 8;

// Safety bound on the constraint-satisfaction loop below. Two weeks of shifts is
// far past any legitimate combination of settings; hitting it means the settings
// are self-contradictory, and we deliver rather than loop.
const MAX_SHIFTS = 14;

type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday .. 6 = Saturday
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Formatter construction is the expensive part of Intl; cache per timezone.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
  } catch {
    // An unknown/garbage timezone must never throw a notification away. Fall
    // back to the firm default rather than crashing the emitter.
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
  }
  formatterCache.set(timeZone, fmt);
  return fmt;
}

// Wall-clock parts of `at` as seen in `timeZone`.
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "0";
  // Intl renders midnight as hour "24" in some ICU versions; normalise to 0.
  const rawHour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

// Offset between UTC and `timeZone` at the given instant, in ms.
function zoneOffsetMs(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The instant at which `timeZone` shows the given wall-clock time.
//
// Two-pass: guess using the offset at the naive timestamp, then re-measure the
// offset at that guess and correct. This is the standard fix for guessing across
// a DST boundary. In the one hour per year that a wall-clock time does not exist
// (spring forward), this lands on a nearby valid instant — correct enough for
// scheduling an email, and it can never loop or throw.
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  const corrected = naive - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

// "HH:MM" / "HH:MM:SS" -> minutes since local midnight. Invalid input returns
// null so callers can fall back rather than scheduling into 1970.
export function parseTimeOfDay(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

// Quiet hours normally WRAP midnight (20:00 -> 07:00), so this is not a simple
// range check. A zero-length window (start === end) is treated as "never quiet"
// rather than "always quiet": failing toward delivering the email is the safer
// direction when the settings are degenerate.
export function isWithinQuietHours(
  minutesOfDay: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return minutesOfDay >= startMinutes && minutesOfDay < endMinutes;
  }
  return minutesOfDay >= startMinutes || minutesOfDay < endMinutes;
}

// Same calendar date shifted by `days`, at the given wall-clock time, in tz.
function shiftDays(
  at: Date,
  days: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const p = zonedParts(at, timeZone);
  // Build via UTC arithmetic so month/year rollover is the platform's problem.
  const rolled = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedTimeToUtc(
    rolled.getUTCFullYear(),
    rolled.getUTCMonth() + 1,
    rolled.getUTCDate(),
    hour,
    minute,
    timeZone,
  );
}

// The next instant at which tz shows `minutes` past midnight, at or after `at`.
function nextTimeOfDay(at: Date, minutes: number, timeZone: string): Date {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const today = shiftDays(at, 0, hour, minute, timeZone);
  return today.getTime() > at.getTime()
    ? today
    : shiftDays(at, 1, hour, minute, timeZone);
}

function nextTopOfHour(at: Date): Date {
  const next = new Date(at.getTime());
  next.setUTCMilliseconds(0);
  next.setUTCSeconds(0);
  next.setUTCMinutes(0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

// When the weekend pause lifts. The user's own preferences win over the
// WEEKEND_RESUME_HOUR default: a daily-digest subscriber wants their digest
// time, and someone with quiet hours wants them respected on Monday too.
function weekendResumeMinutes(settings: DeliverySettings): number {
  if (settings.emailMode === "daily_digest") {
    const t = parseTimeOfDay(settings.dailyDigestTime);
    if (t !== null) return t;
  }
  if (settings.quietHoursEnabled) {
    const t = parseTimeOfDay(settings.quietHoursEnd);
    if (t !== null) return t;
  }
  return WEEKEND_RESUME_HOUR * 60;
}

/**
 * When should this email actually go out?
 *
 * `bypassDeferral` is the catalog's `canDisable: false` — failed billing, a
 * declined signature, a dead integration. Those ignore the master switch, quiet
 * hours, the weekend pause and digest batching, and go immediately (spec Part 2
 * rule 8, acceptance criterion 5).
 */
export function resolveEmailDelivery(input: {
  now: Date;
  settings: DeliverySettings;
  bypassDeferral: boolean;
}): DeliveryDecision {
  const { now, settings, bypassDeferral } = input;

  if (bypassDeferral) return { kind: "send_now" };
  if (!settings.emailEnabled) return { kind: "suppress", reason: "email_disabled" };

  const tz = settings.timezone || "America/Toronto";
  const quietStart = settings.quietHoursEnabled
    ? parseTimeOfDay(settings.quietHoursStart)
    : null;
  const quietEnd = settings.quietHoursEnabled
    ? parseTimeOfDay(settings.quietHoursEnd)
    : null;
  const quietActive =
    settings.quietHoursEnabled && quietStart !== null && quietEnd !== null;

  // Starting point: instant fires now; digests batch to their next window.
  let reason: DeferReason;
  let candidate: Date;
  if (settings.emailMode === "hourly_digest") {
    candidate = nextTopOfHour(now);
    reason = "hourly_digest";
  } else if (settings.emailMode === "daily_digest") {
    const t = parseTimeOfDay(settings.dailyDigestTime) ?? 8 * 60;
    candidate = nextTimeOfDay(now, t, tz);
    reason = "daily_digest";
  } else {
    candidate = now;
    reason = "quiet_hours"; // only used if a shift below actually happens
  }
  const deferredByDigest = settings.emailMode !== "instant";

  // Push the candidate forward until it violates nothing. Order matters: the
  // weekend check can land us inside quiet hours, and lifting quiet hours can
  // land us on a Saturday, so this iterates rather than doing one pass each.
  let shifted = false;
  for (let i = 0; i < MAX_SHIFTS; i++) {
    const p = zonedParts(candidate, tz);

    if (settings.pauseWeekends && isWeekend(p.weekday)) {
      const resume = weekendResumeMinutes(settings);
      // Sunday -> +1 day, Saturday -> +2 days.
      const daysToMonday = p.weekday === 6 ? 2 : 1;
      candidate = shiftDays(
        candidate,
        daysToMonday,
        Math.floor(resume / 60),
        resume % 60,
        tz,
      );
      if (!deferredByDigest) reason = "weekend";
      shifted = true;
      continue;
    }

    if (quietActive) {
      const minutesOfDay = p.hour * 60 + p.minute;
      if (isWithinQuietHours(minutesOfDay, quietStart, quietEnd)) {
        candidate = nextTimeOfDay(candidate, quietEnd, tz);
        if (!deferredByDigest) reason = "quiet_hours";
        shifted = true;
        continue;
      }
    }

    break;
  }

  if (!deferredByDigest && !shifted) return { kind: "send_now" };
  return { kind: "defer", sendAfter: candidate, reason };
}
