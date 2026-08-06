import type { StatusTone } from "@/components/ui/status-capsule";

// ONE mapping from a job's derived status to the colour it wears.
//
// ── WHY IT IS NOT INLINE ───────────────────────────────────────────────────
//
// It was: the board had a ternary, and every other surface that shows a status
// had its own. That is how "In progress" ends up accent on one screen and amber
// on another — which CLAUDE.md's task rule names explicitly ("Status labels,
// the status dot colours and the due-date formatting live in ONE shared
// component").
//
// The STATUS ITSELF is still derived, never stored: `derivedStatus` comes from
// lib/attention, which reads what the workflow engine knows. The session that
// built that engine left the rule for this board — a hand-set status "lies
// within a week". This file only decides what colour a derived answer wears.

export type DerivedStatus = string;

// The REAL vocabulary: EngagementStatus is draft | sent | in_progress |
// complete | cancelled, and `derivedStatus` adds "ready_to_review" on top. An
// earlier draft of this file had branches for statuses that do not exist in
// this codebase (awaiting_documents, on_hold, not_started) — dead code that
// read like a spec.
export function statusTone(derivedStatus: DerivedStatus): StatusTone {
  switch (derivedStatus) {
    // Done.
    case "complete":
      return "success";
    // The engine is holding a gate open for the accountant — the one status
    // that means "you specifically are the blocker".
    case "ready_to_review":
      return "success";
    // Sent and not yet accepted, or never sent. Waiting on the client, and
    // the chase engine is already acting on it.
    case "sent":
      return "warning";
    case "draft":
      return "muted";
    case "cancelled":
      return "destructive";
    // Work is open. The ordinary, active case — and the blue the founder was
    // looking for: "In progress" is accent.
    case "in_progress":
    default:
      return "accent";
  }
}
