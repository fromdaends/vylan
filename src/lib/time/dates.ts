// Turning "the day the accountant picked" into an instant that STAYS on that
// day.
//
// A manual time entry stores started_at as a timestamptz, but the accountant
// chose a DATE. Storing that date's UTC midnight puts a Quebec entry on the
// previous evening local time — the same trap the agenda card's dayWindow()
// and lib/tasks/dates.ts already learned (UTC midnight is yesterday 20:00 in
// Quebec, so month buckets and day filters would both file the hour on the
// wrong day). Noon LOCAL is the instant furthest from both midnights, so the
// entry lands inside the chosen day in the firm's timezone AND in UTC for
// every offset this side of the antimeridian.

/** The UTC instant of 12:00 local time on the given YYYY-MM-DD in the given
 *  IANA timezone. Null for malformed input. */
export function noonInTimeZone(day: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // Start from UTC noon, read what wall-clock that renders as in the zone,
  // and shift by the difference. One correction is exact everywhere a DST
  // change doesn't land ON local noon — and no real zone changes at noon.
  const guess = Date.UTC(y, mo - 1, d, 12);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    // What the guess reads as, expressed on the same fake-UTC scale.
    const rendered = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      // Intl renders midnight as "24" in some engines under hourCycle h24
      // quirks; normalize.
      get("hour") % 24,
      get("minute"),
    );
    if (Number.isNaN(rendered)) return null;
    return new Date(guess + (guess - rendered));
  } catch {
    // Unknown timezone string — fall back to plain UTC noon rather than
    // refusing the entry over metadata.
    return new Date(guess);
  }
}
