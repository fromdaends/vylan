// The running timer's readout: "26m 5s", growing to "1h 26m 5s".
//
// SECONDS, which is the one place this product shows them. Everywhere else a
// duration is minutes because a stored entry is minutes — putting seconds on a
// finished entry would imply a precision the record does not carry.
//
// `formatElapsed` in lib/time/duration.ts is the OTHER shape (0:07 / 1:03:09),
// used by the global timer dock. Both exist on purpose: the dock is a clock
// face in a pill, this is a sentence on a card. They are not duplicates of each
// other, and neither should be rewritten to match the other's caller.
export function formatRunning(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}
