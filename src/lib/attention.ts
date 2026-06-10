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
  // DISPLAY progress for accountant-side bars (the Overview table + engagement
  // lists): the share of REQUIRED items the accountant has APPROVED (a
  // signature item counts once its signed copy is confirmed, which sets it
  // approved). Optional items are excluded; "na" items are excused and count
  // neither way. Zero required items -> approved share of ALL items; no items
  // at all -> 0. Separate from completionPct on purpose: completionPct keeps
  // measuring the CLIENT's part (drives the due-soon / quiet triggers), while
  // approvedPct measures the accountant's clearance, so a fully-submitted
  // engagement reads 67% awaiting review instead of a premature 100%.
  approvedPct: number;
  // The share (same denominator) submitted and awaiting an accountant
  // decision — the dimmer second segment of the two-tone progress bar.
  awaitingPct: number;
  itemsTotal: number;
  itemsDone: number;
  itemsPendingRequired: number;
  itemsReadyToReview: number;
  // Items the client has actually uploaded a file for, regardless of the AI's
  // verdict (submitted / approved / rejected / AI-bounced all count; "na" and a
  // truly-pending item do not).
  itemsUploaded: number;
  // Required items the CLIENT still owes something usable on: truly pending
  // (nothing uploaded, not AI-bounced) or rejected-awaiting-replacement (the
  // accountant sent the file back, no newer upload yet). While any required
  // item is blocked the engagement cannot be Ready to review — the unified
  // status reads "In progress" because the ball is in the client's court.
  itemsRequiredBlocked: number;
  // Required-item totals for the "everything approved, awaiting Mark complete"
  // arm of Ready to review: when every required item is approved (or excused
  // via N/A) the client's part is done and the engagement parks in Ready to
  // review until the accountant completes it.
  requiredCount: number;
  itemsRequiredApprovedOrNa: number;
  // Engagement is live (sent / in_progress) — i.e. the client can still act and
  // there's something to collect/review. Terminal statuses (draft, complete,
  // cancelled) are not live.
  isLive: boolean;
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
  // Blocked = the client still owes something usable: truly pending, or
  // rejected (sent back, awaiting the replacement upload). An AI-bounced item
  // is NOT blocked — a file exists and the accountant can override the AI.
  const itemsRequiredBlocked = requiredItems.filter(
    (i) =>
      (i.status === "pending" && !isAiBounced(i)) || i.status === "rejected",
  ).length;
  const requiredCount = requiredItems.length;
  const itemsRequiredApprovedOrNa = requiredItems.filter(
    (i) => i.status === "approved" || i.status === "na",
  ).length;
  // Files the client has actually provided — independent of the AI's call.
  // submitted/approved/rejected all have a file behind them, as does an
  // AI-bounced item (uploaded → flagged → reopened). "na" and a truly-pending
  // item have no file.
  const itemsUploaded = items.filter(
    (i) => isAiBounced(i) || (i.status !== "pending" && i.status !== "na"),
  ).length;
  // Display progress (see the AttentionResult comment): approved share of the
  // required items, excused (na) items out of both sides, optionals excluded
  // unless there are no required items at all. No countable items -> 0.
  const countable = (
    requiredItems.length > 0 ? requiredItems : items
  ).filter((i) => i.status !== "na");
  const approvedPct =
    countable.length === 0
      ? 0
      : countable.filter((i) => i.status === "approved").length /
        countable.length;
  const awaitingPct =
    countable.length === 0
      ? 0
      : countable.filter((i) => i.status === "submitted" || isAiBounced(i))
          .length / countable.length;
  const isLive = e.status === "sent" || e.status === "in_progress";

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
      approvedPct,
      awaitingPct,
      itemsTotal,
      itemsDone,
      itemsPendingRequired,
      itemsReadyToReview,
      itemsUploaded,
      itemsRequiredBlocked,
      requiredCount,
      itemsRequiredApprovedOrNa,
      isLive,
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
    approvedPct,
    awaitingPct,
    itemsTotal,
    itemsDone,
    itemsPendingRequired,
    itemsReadyToReview,
    itemsUploaded,
    itemsRequiredBlocked,
    requiredCount,
    itemsRequiredApprovedOrNa,
    isLive,
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

// The ONE checklist-side "Ready to review" rule, shared by every surface (the
// unified status pill, the sidebar bucket + badge, the Inbox queue, Needs
// attention). Ready means the accountant — not the client — holds the ball:
//   * no required item is blocked on the client (nothing usable yet, or a
//     rejected file awaiting its replacement), AND
//   * something awaits an accountant decision (a submitted file or an
//     AI-bounced upload), OR every required item is already approved/N/A —
//     the "all approved, park here until Mark complete" state.
// Optional items never block readiness; a submission on an optional item DOES
// count as work awaiting the accountant (covers zero-required engagements).
export function isReadyToReview(a: AttentionResult): boolean {
  if (a.itemsRequiredBlocked > 0) return false;
  if (a.itemsReadyToReview > 0) return true;
  return (
    a.requiredCount > 0 && a.itemsRequiredApprovedOrNa === a.requiredCount
  );
}

// The unified engagement status every surface displays. Layered on the stored
// lifecycle column: draft / complete / cancelled pass through untouched, and a
// live engagement (sent / in_progress) is re-read as "ready_to_review" the
// moment the checklist says the accountant holds the ball (isReadyToReview).
// Server-side derivation — no surface keeps private status math.
export type DerivedEngagementStatus =
  | Engagement["status"]
  | "ready_to_review";

export function deriveEngagementStatus(
  status: Engagement["status"],
  a: AttentionResult,
): DerivedEngagementStatus {
  if ((status === "sent" || status === "in_progress") && isReadyToReview(a)) {
    return "ready_to_review";
  }
  return status;
}

// "The client has finished their part." Every required item is in (nothing
// left waiting on the client) AND at least one file was actually uploaded —
// REGARDLESS of what the AI decided about those files (approved, rejected, or
// still awaiting a human decision all count). Scoped to live engagements.
//
// This is deliberately broader than isReadyToReview: when the AI auto-approves
// every upload there's no item left "submitted", so isReadyToReview goes quiet
// even though the client is done. The What's-new feed uses this so the firm
// always learns the moment a client finishes uploading.
export function isCollectionComplete(a: AttentionResult): boolean {
  return a.isLive && a.itemsPendingRequired === 0 && a.itemsUploaded > 0;
}
