// Shared types + thresholds for the Performance page data layer (Phase 1).
//
// Every number defined here traces to a real record; the per-section modules
// (money.ts, ai.ts, automation.ts) document exactly how each is computed. Money
// is always integer cents; rates are 0..1 (null when there is nothing to rate).

export type PerformanceRange = "this_month" | "last_3_months" | "all_time";

export const PERFORMANCE_RANGES: PerformanceRange[] = [
  "this_month",
  "last_3_months",
  "all_time",
];

// Below this many assessed documents in range, the AI agreement headline is
// shown as "early data" (counts, but no confident percentage). Spec: under 20.
export const AI_EARLY_DATA_THRESHOLD = 20;

// The time-to-paid lock split (locked vs unlocked invoices) is shown ONLY when
// BOTH groups have at least this many paid invoices in range. Otherwise a single
// honest overall average is shown — never a fabricated comparison. Spec: 5+ each.
export const LOCK_SPLIT_MIN_SAMPLE = 5;

export type MoneyBucketGranularity = "day" | "month";

export type MoneyBucket = {
  // ISO instant of the bucket start (the start of the Eastern day/month).
  start: string;
  // Cents collected inside this bucket.
  cents: number;
};

export type TimeToPaidSplit = {
  lockedAvgDays: number;
  lockedCount: number;
  unlockedAvgDays: number;
  unlockedCount: number;
};

export type MoneySection = {
  currency: string;
  // Range-scoped: sum of invoices PAID inside the selected range.
  collectedCents: number;
  collectedCount: number;
  // Live snapshot of currently-unpaid invoices — deliberately NOT range-scoped.
  outstandingCents: number;
  outstandingCount: number;
  // Collected, bucketed by day (this_month) or month (else). Empty buckets are
  // included as zero so the chart shows a continuous span.
  buckets: MoneyBucket[];
  granularity: MoneyBucketGranularity;
  timeToPaid: {
    // Whole-day average from invoice created/sent to paid, for invoices paid in
    // range. null when no invoices were paid in range.
    avgDays: number | null;
    count: number;
    // Present only when both lock groups meet LOCK_SPLIT_MIN_SAMPLE.
    split: TimeToPaidSplit | null;
  };
};

export type FourCase =
  | "true_pass" // AI looks-right, accountant approved (agreement)
  | "true_catch" // AI flagged/rejected, accountant rejected (agreement)
  | "false_pass" // AI looks-right, accountant rejected (the miss that matters)
  | "false_alarm"; // AI flagged/rejected, accountant approved (safe but noisy)

export const FOUR_CASES: FourCase[] = [
  "true_pass",
  "true_catch",
  "false_pass",
  "false_alarm",
];

export type AiSection = {
  // Documents that got an AI verdict AND a final human decision in range (the
  // agreement denominator).
  assessedCount: number;
  agreementCount: number; // true_pass + true_catch
  agreementRate: number | null; // null when assessedCount === 0
  cases: Record<FourCase, number>;
  // Documents finalized in range whose engagement had AI switched OFF.
  skippedAiOffCount: number;
  // Documents finalized in range with AI on but no verdict on file (read never
  // completed / failed) — a small honesty bucket, excluded from the rate.
  notAnalyzedCount: number;
  earlyData: boolean; // assessedCount < AI_EARLY_DATA_THRESHOLD
};

export type AutomationSection = {
  remindersSent: number; // activity_log 'reminder_fired' in range
  reRequestEmails: number; // activity_log 'client_retry_email_sent' in range
  reRequestTexts: number; // activity_log 'client_retry_sms_sent' in range
};

export type PerformanceData = {
  range: PerformanceRange;
  money: MoneySection;
  ai: AiSection;
  automation: AutomationSection;
};
