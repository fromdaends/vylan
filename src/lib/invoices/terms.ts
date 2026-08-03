// Payment terms: turning "due in N days" into an actual date.
//
// NEUTRAL MODULE — no "use client", no import that reaches the server Supabase
// client. The invoice builder is a client component and needs this to pre-fill
// the due-date field; the automated send path needs the identical answer on the
// server. Same function, so a hand-raised invoice and an automatic one are due
// on the same day given the same terms.

export const DUE_DAYS_MIN = 0; // 0 = due on receipt, a real commercial term
export const DUE_DAYS_MAX = 365;
export const DUE_DAYS_DEFAULT = 30;

// Clamp a stored or typed value into the bounds the database also enforces.
// null passes through: it means "no due date at all", which is a deliberate
// choice a firm can make and NOT the same as 0.
export function normalizeDueDays(
  raw: number | null | undefined,
): number | null {
  if (raw == null) return null;
  if (!Number.isFinite(raw)) return DUE_DAYS_DEFAULT;
  return Math.min(DUE_DAYS_MAX, Math.max(DUE_DAYS_MIN, Math.round(raw)));
}

// The due date for an invoice issued on `issueDay`, or null when the firm has
// no default. Pure date arithmetic on the ISO day — deliberately not via
// `new Date(...)` + setDate, which drags in the local timezone and can shift
// the answer by a day either side of midnight.
export function dueDateFrom(
  issueDay: string,
  dueDays: number | null | undefined,
): string | null {
  const days = normalizeDueDays(dueDays);
  if (days == null) return null;
  const [y, m, d] = issueDay.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  // Date.UTC normalizes overflow for us: month 13 becomes January of the next
  // year, day 32 rolls into the next month, and leap years are handled.
  const at = new Date(Date.UTC(y, m - 1, d + days));
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString().slice(0, 10);
}

// Today, as an ISO day, in UTC — the same basis issue_date is stored on.
export function todayIsoDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
