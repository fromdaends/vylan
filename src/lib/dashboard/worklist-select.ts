import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

// Pure selectors for the Inbox triage lists. Kept free of any server imports
// (only a type from the worklist component) so they're trivially unit-testable
// and shared by /inbox without re-deriving the filters inline.

// Engagements that need chasing — any attention reason (overdue, due soon,
// gone quiet), most urgent first. Powers the Inbox "Needs attention" list and
// mirrors the scoring the dashboard used for its old "Needs attention" tab.
export function selectNeedsAttention(rows: WorklistRow[]): WorklistRow[] {
  return rows
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => b.attentionScore - a.attentionScore);
}

// Overview "Needs attention" block (2.0): everything that requires the
// ACCOUNTANT to act, one row per engagement — ready to review, flagged files
// awaiting a call, a returned signed copy to confirm, submissions sitting
// unreviewed past the threshold, plus the existing chase signals (overdue /
// due soon / quiet). The actionable to-do list; What's new stays the passive
// log.
//
// Sort: MOST URGENT first, by time tier:
//   1. Overdue        — more days overdue first
//   2. Due soon       — sooner due first
//   3. Waiting / quiet (and anything with no deadline) — longest first, by the
//      larger of "waiting" (waitingDays) vs "quiet" (daysSinceClientActivity)
// Flagged files / unpaid status do NOT affect the order. Ties fall back to the
// larger waiting/quiet/overdue day count, then most recent activity, so the
// order is always stable and deterministic.

// 0 = overdue, 1 = due soon, 2 = everything else (waiting / quiet / no deadline).
function attentionTier(r: WorklistRow): 0 | 1 | 2 {
  if (r.reasons.includes("overdue")) return 0;
  if (r.reasons.includes("due_soon")) return 1;
  return 2;
}

// How long a non-deadline row has been outstanding: the larger of "waiting"
// (submissions sitting unreviewed) and "quiet" (no client activity).
function waitingMagnitude(r: WorklistRow): number {
  return Math.max(r.waitingDays ?? 0, r.daysSinceClientActivity ?? 0);
}

export function selectNeedsAttentionRows(rows: WorklistRow[]): WorklistRow[] {
  return rows
    .filter(
      (r) =>
        r.reasons.length > 0 ||
        r.readyToReview ||
        r.flaggedFilesCount > 0 ||
        r.signedCopiesToConfirm > 0 ||
        r.sittingUnreviewed,
    )
    .sort((a, b) => {
      const ta = attentionTier(a);
      const tb = attentionTier(b);
      if (ta !== tb) return ta - tb; // overdue (0) < due soon (1) < waiting (2)

      if (ta === 0) {
        // Overdue: more days overdue first.
        const d = (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0);
        if (d !== 0) return d;
      } else if (ta === 1) {
        // Due soon: sooner first.
        const d = (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0);
        if (d !== 0) return d;
      } else {
        // Waiting / quiet: longest first.
        const d = waitingMagnitude(b) - waitingMagnitude(a);
        if (d !== 0) return d;
      }

      // Tiebreaker: larger waiting/quiet/overdue day count, then freshest.
      const tieA = Math.max(waitingMagnitude(a), a.daysOverdue ?? 0);
      const tieB = Math.max(waitingMagnitude(b), b.daysOverdue ?? 0);
      if (tieB !== tieA) return tieB - tieA;
      return b.recencyAt.localeCompare(a.recencyAt);
    });
}

// Engagements with every required item in, awaiting the accountant's review —
// freshest first. Powers the Inbox "Ready to review" list.
export function selectReadyToReview(rows: WorklistRow[]): WorklistRow[] {
  return rows
    .filter((r) => r.readyToReview)
    .sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
}

// Active = still in flight (draft / sent / in progress). Completed and
// cancelled engagements drop out of the dashboard worklist and become the
// "Active" view on /engagements; finished work lives under the Completed /
// All filters there instead.
export function selectActive(rows: WorklistRow[]): WorklistRow[] {
  return rows.filter(
    (r) => r.status !== "complete" && r.status !== "cancelled",
  );
}

// Recent / Mine on the *dashboard* worklist. Like selectActive but KEEPS
// cancelled engagements, so a cancellation doesn't silently vanish from the
// board — it stays in place (with its red "Cancelled" badge) until it ages
// out of the recency sort. Only successfully-completed work moves off to the
// dedicated Complete tab. (/engagements keeps the stricter selectActive for
// its "Active" filter, where a cancelled engagement genuinely isn't active.)
export function selectRecent(rows: WorklistRow[]): WorklistRow[] {
  return rows.filter((r) => r.status !== "complete");
}

// Completed = marked done. The /engagements "Completed" filter.
export function selectCompleted(rows: WorklistRow[]): WorklistRow[] {
  return rows.filter((r) => r.status === "complete");
}

// "Mine" — engagements assigned to `userId`. Shared by the Overview worklist's
// Mine tab and the /engagements Mine/All filter so the rule lives in one place.
// A null user has no assignments (returns []).
export function selectAssignedTo(
  rows: WorklistRow[],
  userId: string | null,
): WorklistRow[] {
  if (!userId) return [];
  return rows.filter((r) => r.assigneeUserId === userId);
}
