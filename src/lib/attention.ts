// "Who do I need to chase today?" scoring.
//
// The dashboard surfaces engagements that match any of:
//   * status is sent or in_progress AND due_date <= today (overdue)
//   * status is sent or in_progress AND due_date within 7 days AND <80% complete
//   * status is sent or in_progress AND no client activity in 5+ days
//
// Completion = (submitted + approved + na) / total required-or-submitted items
// — i.e. required items count toward the denominator; optional items that
// were uploaded also count (so a client uploading "bonus" docs nudges %).

import type { Engagement } from "@/lib/db/engagements";
import type { RequestItem } from "@/lib/db/request-items";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AttentionReason = "overdue" | "due_soon" | "stale";

export type AttentionResult = {
  reasons: AttentionReason[];
  daysOverdue: number | null;
  daysUntilDue: number | null;
  daysSinceClientActivity: number | null;
  completionPct: number;
  itemsTotal: number;
  itemsDone: number;
  itemsPendingRequired: number;
  itemsReadyToReview: number;
};

export function computeAttention(opts: {
  engagement: Engagement;
  items: RequestItem[];
  lastClientActivityAt: string | null;
  now?: Date;
}): AttentionResult {
  const now = opts.now ?? new Date();
  const e = opts.engagement;
  const items = opts.items;

  // Count completion using required items as the denominator. If there are
  // no required items, fall back to all items (covers Custom templates).
  const requiredItems = items.filter((i) => i.required);
  const denom = requiredItems.length > 0 ? requiredItems : items;
  const doneSet = new Set(["submitted", "approved", "na"]);
  const itemsDone = denom.filter((i) => doneSet.has(i.status)).length;
  const itemsTotal = denom.length;
  const completionPct =
    itemsTotal === 0 ? 1 : Math.min(1, itemsDone / itemsTotal);

  const itemsPendingRequired = requiredItems.filter(
    (i) => i.status === "pending",
  ).length;
  const itemsReadyToReview = items.filter(
    (i) => i.status === "submitted",
  ).length;

  let daysOverdue: number | null = null;
  let daysUntilDue: number | null = null;
  if (e.due_date) {
    const due = new Date(`${e.due_date}T23:59:59Z`).getTime();
    const diff = (now.getTime() - due) / DAY_MS;
    if (diff > 0) daysOverdue = Math.ceil(diff);
    else daysUntilDue = Math.ceil(-diff);
  }

  let daysSinceClientActivity: number | null = null;
  if (e.sent_at) {
    const base = opts.lastClientActivityAt ?? e.sent_at;
    daysSinceClientActivity = Math.floor(
      (now.getTime() - new Date(base).getTime()) / DAY_MS,
    );
  }

  const reasons: AttentionReason[] = [];
  const isLive = e.status === "sent" || e.status === "in_progress";

  if (isLive && daysOverdue != null && daysOverdue > 0) {
    reasons.push("overdue");
  }
  if (
    isLive &&
    daysUntilDue != null &&
    daysUntilDue <= 7 &&
    completionPct < 0.8
  ) {
    reasons.push("due_soon");
  }
  if (isLive && daysSinceClientActivity != null && daysSinceClientActivity >= 5) {
    reasons.push("stale");
  }

  return {
    reasons,
    daysOverdue,
    daysUntilDue,
    daysSinceClientActivity,
    completionPct,
    itemsTotal,
    itemsDone,
    itemsPendingRequired,
    itemsReadyToReview,
  };
}

// Severity for sorting on the dashboard. Higher = more urgent.
export function attentionScore(a: AttentionResult): number {
  if (a.reasons.length === 0) return 0;
  let score = 0;
  if (a.daysOverdue != null) score += 1000 + a.daysOverdue;
  if (a.reasons.includes("due_soon")) score += 500;
  if (a.reasons.includes("stale") && a.daysSinceClientActivity != null) {
    score += 100 + a.daysSinceClientActivity * 5;
  }
  return score;
}

export function isReadyToReview(a: AttentionResult): boolean {
  // All required items are non-pending AND at least one item is submitted
  // (i.e. needs an approve/reject decision).
  return a.itemsPendingRequired === 0 && a.itemsReadyToReview > 0;
}
