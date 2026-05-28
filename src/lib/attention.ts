// "Who do I need to chase today?" scoring.
//
// The dashboard surfaces engagements that match any of:
//   * status is sent or in_progress AND due_date <= today (overdue)
//   * status is sent or in_progress AND due_date within 7 days AND <80% complete
//   * status is sent or in_progress AND no client activity in 5+ days AND
//     not yet fully collected (something is still outstanding from the client)
//
// An engagement that requests no documents (0 items) is never surfaced: there
// is nothing for the client to act on, so none of the above can apply to it.
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

  // An item that's status="pending" with a rejection_reason set was
  // bounced by the AI — the client uploaded something, the classifier
  // flagged it, and it was reopened. The accountant should still be
  // able to see it (and override) from the "Ready to review" tile;
  // otherwise the engagement disappears from the dashboard the moment
  // the AI says "nope" even though the firm might want to weigh in.
  // True pending (waiting on the client to upload anything at all) is
  // status="pending" with rejection_reason still null.
  const isAiBounced = (i: RequestItem) =>
    i.status === "pending" && i.rejection_reason !== null;
  const itemsPendingRequired = requiredItems.filter(
    (i) => i.status === "pending" && !isAiBounced(i),
  ).length;
  const itemsReadyToReview = items.filter(
    (i) => i.status === "submitted" || isAiBounced(i),
  ).length;

  // No requested documents → nothing to collect, chase, or be overdue on.
  // Bail before any reason is computed so it stays out of Needs attention
  // entirely (the dashboard derives that section purely from reasons).
  if (itemsTotal === 0) {
    return {
      reasons: [],
      daysOverdue: null,
      daysUntilDue: null,
      daysSinceClientActivity: null,
      completionPct,
      itemsTotal,
      itemsDone,
      itemsPendingRequired,
      itemsReadyToReview,
    };
  }

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
  if (
    isLive &&
    daysSinceClientActivity != null &&
    daysSinceClientActivity >= 5 &&
    completionPct < 1
  ) {
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
