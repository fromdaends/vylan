// The day window a calendar read asks for, and how an event becomes a row.
//
// Pure and framework-free so the fiddly parts are directly testable — these are
// exactly the calculations that look right and are wrong by one timezone.
//
// THE PROBLEM THIS SOLVES: Google wants timeMin/timeMax as absolute instants,
// but "Monday" is a local idea. A firm in Montreal asking for "Aug 3" means
// 00:00–24:00 Eastern, which is 04:00 Aug 3 – 04:00 Aug 4 UTC. Sending naive
// UTC midnight silently shows the wrong day's meetings for four hours every
// evening — the same class of bug the greeting's date had.

export type DayWindow = { timeMin: string; timeMax: string };

/**
 * The UTC offset of a timezone at a given instant, in minutes (Montreal in
 * August => -240). Derived from Intl rather than a table, so DST is handled by
 * the platform and never drifts.
 */
export function offsetMinutes(timeZone: string, at: Date): number {
  // 'en-US' with these options gives a parseable "MM/DD/YYYY, HH:MM:SS".
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Hour 24 is how some ICU builds spell midnight under hour12:false.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Midnight-to-midnight for one calendar day in one timezone, as ISO instants.
 *
 * The offset is resolved AT that day (not today), so a window computed in
 * January for a day in July uses July's offset.
 */
export function dayWindow(day: string, timeZone: string): DayWindow {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) {
    // Malformed input: fall back to a UTC day rather than throwing inside a
    // dashboard render. The card degrades to "nothing scheduled".
    const t = `${day}T00:00:00.000Z`;
    return { timeMin: t, timeMax: t };
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Probe at local noon — far from any DST boundary, so the offset we read is
  // unambiguously that day's.
  const noonUtcGuess = new Date(Date.UTC(y, mo - 1, d, 12));
  const off = offsetMinutes(timeZone, noonUtcGuess);
  const startUtcMs = Date.UTC(y, mo - 1, d, 0, 0, 0) - off * 60000;
  return {
    timeMin: new Date(startUtcMs).toISOString(),
    timeMax: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** One event as Google returns it, narrowed to what the card draws. */
export type GoogleEventLike = {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  htmlLink?: unknown;
  start?: { dateTime?: unknown; date?: unknown } | null;
  end?: { dateTime?: unknown; date?: unknown } | null;
};

export type MappedEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  href?: string;
  /** True for a whole-day entry — it has a date but no time. */
  allDay: boolean;
};

/**
 * Google's event shape → the card's. Returns null for anything unrenderable so
 * a single malformed entry can never blank the whole agenda.
 *
 * Cancelled events are dropped: Google returns them in a plain list and showing
 * a meeting somebody called off is worse than showing nothing.
 */
export function mapGoogleEvent(raw: GoogleEventLike): MappedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.status === "cancelled") return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;

  const startTime =
    typeof raw.start?.dateTime === "string" ? raw.start.dateTime : null;
  const endTime = typeof raw.end?.dateTime === "string" ? raw.end.dateTime : null;
  const startDate = typeof raw.start?.date === "string" ? raw.start.date : null;
  const endDate = typeof raw.end?.date === "string" ? raw.end.date : null;

  // A timed event needs a start; an all-day one has `date` instead.
  const allDay = !startTime && Boolean(startDate);
  const startsAt = startTime ?? (startDate ? `${startDate}T00:00:00.000Z` : null);
  if (!startsAt) return null;
  const endsAt =
    endTime ?? (endDate ? `${endDate}T00:00:00.000Z` : startsAt);

  // An untitled event is "(no title)" in Google's own UI; mirror that rather
  // than dropping a real meeting for having an empty name.
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";

  return {
    id,
    title: summary || "(no title)",
    startsAt,
    endsAt,
    href: typeof raw.htmlLink === "string" ? raw.htmlLink : undefined,
    allDay,
  };
}
