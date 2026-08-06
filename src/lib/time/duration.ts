// Duration input, the way people actually type it.
//
// The manual-entry dialog accepts "1:30", "1.5", "90m", "2h", "1h30" and
// normalizes everything to MINUTES — the one unit time_entries stores. Pure
// functions, no Date, no locale objects, so the parser can be argued with in a
// test rather than in production.
//
// THE ONE AMBIGUITY, decided once, here: a bare number is HOURS. "1.5" must be
// 90 minutes (the spec's own example), and "1.5 minutes" is not a thing anyone
// logs — so consistency says "2" is two hours as well, matching how Harvest and
// Toggl read a bare number. Minutes are always available by saying so: "90m".
//
// French-speaking hands type a COMMA decimal ("1,5") — half this product's
// users work in French, so the parser folds it rather than making half the
// firm's entries fail on a keyboard habit.

/** "1:30" | "1.5" | "1,5" | "90m" | "2h" | "1h30" | "45 min" → minutes.
 *  Null for anything unreadable, zero, or negative — the caller decides what
 *  to say; the parser never guesses. */
export function parseDurationToMinutes(raw: string): number | null {
  const input = raw.trim().toLowerCase().replace(",", ".");
  if (!input) return null;

  // h:mm — "1:30", "0:45", "10:05".
  const colon = /^(\d{1,3}):([0-5]?\d)$/.exec(input);
  if (colon) {
    const minutes = Number(colon[1]) * 60 + Number(colon[2]);
    return minutes > 0 ? minutes : null;
  }

  // "1h30", "1h 30", "1h30m", "2h" — hours with optional trailing minutes.
  const hm = /^(\d{1,3}(?:\.\d+)?)\s*h(?:\s*([0-5]?\d)\s*m?(?:in)?)?$/.exec(
    input,
  );
  if (hm) {
    const minutes = Math.round(
      Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0),
    );
    return minutes > 0 ? minutes : null;
  }

  // "90m", "90 min", "90min", "90 minutes".
  const m = /^(\d{1,4}(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/.exec(input);
  if (m) {
    const minutes = Math.round(Number(m[1]));
    return minutes > 0 ? minutes : null;
  }

  // Bare number → HOURS (see the header).
  const bare = /^(\d{1,3}(?:\.\d+)?)$/.exec(input);
  if (bare) {
    const minutes = Math.round(Number(bare[1]) * 60);
    return minutes > 0 ? minutes : null;
  }

  return null;
}

/** Minutes → "1h 30m" / "45m" / "3h". For lists and totals; never for input. */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Seconds since a timer started → "0:07", "12:45", "1:03:09". The pill's
 *  ticking readout: mm:ss under an hour, h:mm:ss over it. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
