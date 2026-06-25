// QuickBooks Stage 4, Phase 2 — draft status state machine (pure).
//
// A draft suggestion moves through three states:
//   draft     — the accountant is still reviewing / editing it (the default).
//   approved  — marked ready to post. Stage 5 will post APPROVED drafts; nothing
//               is posted yet. A draft can only be approved once it is COMPLETE
//               (no missing vendor/customer, account, tax code, total, etc.).
//   dismissed — intentionally skipped (e.g. a personal receipt that should never
//               become a QuickBooks entry).
//   posted    — written to QuickBooks (Stage 5). Reopening it returns the draft
//               to 'approved' (the post must be undone/voided in QuickBooks
//               separately — the void route does that before reopening).
//
// Transitions are deliberately narrow so the card UI stays simple:
//   draft     -> approved | dismissed
//   approved  -> draft (reopen) | posted (Stage 5 post)
//   dismissed -> draft (reopen)
//   posted    -> approved (Stage 5 undo/void)
// You cannot go approved -> dismissed (or vice-versa) directly; reopen first.
// This is pure + unit-tested; the route handlers and the card both rely on it.

import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";
import { draftNeedsInput } from "./draft-resolve";

export const DRAFT_STATUSES = [
  "draft",
  "approved",
  "dismissed",
  "posted",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

// Coerce a stored status string (the column is free-form text, default 'draft')
// into a known state. Anything unrecognised is treated as 'draft' so an
// unexpected value never strands a card in a state with no controls.
export function normalizeDraftStatus(s: string | null | undefined): DraftStatus {
  return s === "approved" || s === "dismissed" || s === "posted" ? s : "draft";
}

export function isDraftStatus(s: unknown): s is DraftStatus {
  return (
    s === "draft" || s === "approved" || s === "dismissed" || s === "posted"
  );
}

// Is moving from `from` to `to` a permitted transition via the generic status
// route (approve / dismiss / reopen)? Same-state is rejected. Transitions to/from
// 'posted' are deliberately NOT permitted here — posting and undo go through the
// dedicated /post and /void routes (which must touch QuickBooks), so reopening a
// posted draft to 'draft' must never happen without first voiding in QuickBooks.
export function canTransitionDraft(from: DraftStatus, to: DraftStatus): boolean {
  if (from === to) return false;
  if (from === "posted" || to === "posted") return false;
  if (to === "draft") return from === "approved" || from === "dismissed";
  // Approve / dismiss are only reachable from a fresh draft.
  return from === "draft";
}

// Can this draft be APPROVED right now? Only when it is complete — the same
// "needs input" test the roll-up and the card's amber cells use. Dismiss has no
// such gate (you can always skip a draft).
export function canApproveDraft(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): boolean {
  return !draftNeedsInput(suggestion, resolved);
}
