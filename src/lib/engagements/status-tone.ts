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

export function statusTone(derivedStatus: DerivedStatus): StatusTone {
  switch (derivedStatus) {
    // Done, and paid-and-filed downstream of it.
    case "complete":
      return "success";
    // The engine is holding a gate open for the accountant — the one status
    // that means "you specifically are the blocker".
    case "ready_to_review":
      return "success";
    // The chase engine is already acting: documents outstanding with the
    // client. Amber because it is waiting, not late.
    case "awaiting_documents":
    case "collecting":
      return "warning";
    // Sent, not yet accepted.
    case "draft":
    case "sent":
    case "not_started":
      return "muted";
    // Deliberately parked. The one genuinely manual state.
    case "on_hold":
      return "muted";
    case "cancelled":
      return "destructive";
    // Work is open. The ordinary, active case.
    default:
      return "accent";
  }
}
