// QuickBooks Stage 4, Phase 2 — draft status state machine (pure).
//
// A draft suggestion moves through three states:
//   draft     — the accountant is still reviewing / editing it (the default).
//   approved  — marked ready to post. Stage 5 will post APPROVED drafts; nothing
//               is posted yet. A draft can only be approved once it is COMPLETE
//               (no missing vendor/customer, account, tax code, total, etc.).
//   dismissed — intentionally skipped (e.g. a personal receipt that should never
//               become a QuickBooks entry).
//
// Transitions are deliberately narrow so the card UI stays simple:
//   draft     -> approved | dismissed
//   approved  -> draft        (reopen)
//   dismissed -> draft        (reopen)
// You cannot go approved -> dismissed (or vice-versa) directly; reopen first.
// This is pure + unit-tested; the route handler and the card both rely on it.

import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";
import { draftNeedsInput } from "./draft-resolve";

export const DRAFT_STATUSES = ["draft", "approved", "dismissed"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

// Coerce a stored status string (the column is free-form text, default 'draft')
// into a known state. Anything unrecognised is treated as 'draft' so an
// unexpected value never strands a card in a state with no controls.
export function normalizeDraftStatus(s: string | null | undefined): DraftStatus {
  return s === "approved" || s === "dismissed" ? s : "draft";
}

export function isDraftStatus(s: unknown): s is DraftStatus {
  return s === "draft" || s === "approved" || s === "dismissed";
}

// Is moving from `from` to `to` a permitted transition? Same-state is rejected
// (the routes treat it as a no-op the client shouldn't have sent).
export function canTransitionDraft(from: DraftStatus, to: DraftStatus): boolean {
  if (from === to) return false;
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
