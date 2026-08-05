// When does a KPI alert actually fire?
//
// PURE, and tested, because this is the half of the feature that is easy to get
// subtly wrong and impossible to notice: an alert that nags every morning gets
// muted within a week, and an alert that never fires is indistinguishable from
// one that was never created.

export type AlertComparator = "gt" | "lt";
export type AlertFrequency = "hourly" | "daily" | "weekly" | "monthly";
export type AlertMetric = "open" | "overdue" | "completed" | "percent_complete";

export type AlertRule = {
  id: string;
  comparator: AlertComparator;
  threshold: number;
  frequency: AlertFrequency;
  /** The reading at the previous check. Null on an alert that has never run. */
  lastValue: number | null;
  lastFiredAt: string | null;
};

/** Is the condition true of this reading right now? */
export function isBreached(value: number, rule: {
  comparator: AlertComparator;
  threshold: number;
}): boolean {
  return rule.comparator === "gt"
    ? value > rule.threshold
    : value < rule.threshold;
}

/** How long must pass before the same alert may speak again. */
const COOLDOWN_MS: Record<AlertFrequency, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export type AlertDecision =
  | { fire: true; reason: "crossed" }
  | { fire: false; reason: "not_breached" | "still_breached" | "cooling_down" };

/**
 * Decide whether an alert should notify anyone, given what the number is now.
 *
 * ⚠️ IT FIRES ON THE CROSSING, NOT ON THE STATE.
 *
 * "Open tasks > 100" checked daily, on a firm that sits at 140 for a month, is
 * thirty identical notifications. The thirtieth is worth nothing and the first
 * is worth less because of them — this is how people learn to ignore an alert
 * channel entirely. So a breach only speaks when the PREVIOUS reading was not
 * breached. Coming back under and going over again is a new crossing and does
 * fire.
 *
 * The `frequency` cooldown is a second, independent guard: it stops a value
 * oscillating around the threshold (100 → 101 → 99 → 101) from firing on every
 * single check. Both must pass.
 *
 * An alert that has NEVER run (lastValue null) and is already breached does
 * fire — you asked to be told when it was over 100 and it is over 100. Staying
 * silent because we have no history would mean the alert you just created does
 * nothing until the number happens to dip.
 */
export function decideAlert(
  value: number,
  rule: AlertRule,
  now: Date,
): AlertDecision {
  if (!isBreached(value, rule)) return { fire: false, reason: "not_breached" };

  // Already over the line at the last check, and still over it. Nothing new
  // has happened.
  if (rule.lastValue !== null && isBreached(rule.lastValue, rule)) {
    return { fire: false, reason: "still_breached" };
  }

  if (rule.lastFiredAt) {
    const since = now.getTime() - new Date(rule.lastFiredAt).getTime();
    // A malformed timestamp must not make an alert silent forever — NaN
    // compares false against everything, so treat it as "no cooldown known".
    if (Number.isFinite(since) && since < COOLDOWN_MS[rule.frequency]) {
      return { fire: false, reason: "cooling_down" };
    }
  }

  return { fire: true, reason: "crossed" };
}

/** The sentence a fired alert carries. Formatting only — no i18n here, the
 *  notification renderer translates around these numbers. */
export function alertSummary(rule: {
  comparator: AlertComparator;
  threshold: number;
}, value: number): { value: number; threshold: number; direction: "above" | "below" } {
  return {
    value,
    threshold: rule.threshold,
    direction: rule.comparator === "gt" ? "above" : "below",
  };
}
