// Should this draft approve itself?
//
// The goal is plug and play: if the customer printed on the invoice already
// exists in the client's books under that exact name, nobody should have to
// confirm that. The system should only ask when it is genuinely unsure.
//
// SO THE GATE IS CONFIDENCE, NOT MEMORY. An earlier version of this required
// every field to have come from a remembered correction, which meant the FIRST
// document from a supplier could never go through however perfectly it matched
// — you had to teach it three times first. That is backwards: an exact name
// match is not a weaker signal than a remembered one, it is a stronger one.
//
// The matcher already grades itself, and the grades separate cleanly:
//
//   1.00  exact name match, or an exact tax-token-set match
//   0.99  a mapping the accountant confirmed before (the learned overlay)
//   <0.99 a fuzzy guess — and pickConfident additionally refuses anything
//         within 0.05 of the runner-up, so a close call is already null
//
// Everything at or above 0.99 is "we are sure"; everything below is a guess.
// Learning still matters enormously — it is what pulls the ambiguous fields
// (which expense account? which of two similar tax rates?) up to 0.99 — but it
// is no longer a prerequisite for the fields that were never ambiguous.
//
// EVERY CONDITION BELOW IS A VETO and the default is "ask the human". This is
// the one place in the product that acts on a client's books with nobody
// looking: a false negative costs one click, a false positive puts a wrong
// number in real books that nobody finds until the return.
//
// PURE — no I/O, fully unit-tested.

import { canApproveDraft } from "@/lib/quickbooks/draft-status";
import {
  effectiveSplit,
  effectiveExpenseMode,
  effectiveIncomeMode,
} from "@/lib/quickbooks/draft-resolve";
import type {
  MatchField,
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";

// The line between "sure" and "guessing". Set exactly at the learned-overlay
// value so both an exact match (1.0) and a confirmed mapping (0.99) clear it,
// and every fuzzy match falls short.
export const AUTO_APPROVE_MIN_CONFIDENCE = 0.99;

export type AutoApproveInput = {
  // The firm turned this on. Off by default — nobody gets unattended approval
  // they did not ask for.
  enabled: boolean;
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
  // The near-duplicate flag. Dext never auto-publishes a suspected duplicate
  // and neither do we: auto-approving one is how the same invoice gets paid
  // twice.
  possibleDuplicate: boolean;
};

export type AutoApproveDecision =
  | { approve: true }
  | { approve: false; reason: AutoApproveVeto };

export type AutoApproveVeto =
  | "disabled"
  | "possible_duplicate"
  | "needs_input"
  | "unknown_direction"
  | "not_confident";

// Is this field settled, or is the system guessing? A field the accountant has
// already chosen by hand counts as settled whatever the AI thought.
function settled(field: MatchField | undefined, chosen: boolean): boolean {
  if (chosen) return true;
  if (!field?.match) return false;
  return field.confidence >= AUTO_APPROVE_MIN_CONFIDENCE;
}

export function decideAutoApprove(
  input: AutoApproveInput,
): AutoApproveDecision {
  const s = input.suggestion;
  const r = input.resolved;

  if (!input.enabled) return { approve: false, reason: "disabled" };

  // Checked early and alone: a suspected duplicate is never auto-approved no
  // matter how confidently every field matched.
  if (input.possibleDuplicate) {
    return { approve: false, reason: "possible_duplicate" };
  }

  // We could not tell money-in from money-out. Nothing downstream is
  // meaningful, so there is nothing to be confident about.
  if (s.direction !== "expense" && s.direction !== "income") {
    return { approve: false, reason: "unknown_direction" };
  }

  // Complete by exactly the rule the Approve button uses — never a parallel,
  // looser definition of "ready".
  if (!canApproveDraft(s, r)) {
    return { approve: false, reason: "needs_input" };
  }

  // The other party. An exact name match here is the commonest reason a draft
  // should sail through untouched.
  if (!settled(s.party, r?.party != null)) {
    return { approve: false, reason: "not_confident" };
  }

  if (s.direction === "income") {
    // The line posts against a product/service.
    if (!settled(s.item, r?.item != null)) {
      return { approve: false, reason: "not_confident" };
    }
  } else if (effectiveSplit(s, r)) {
    // A SPLIT expense is only as settled as its least-settled line — one
    // guessed line account is a guessed draft.
    const lines = s.lines ?? [];
    const allLinesSettled = lines.every((l, i) =>
      settled(l.account, r?.lineAccounts?.[String(i)] != null),
    );
    if (!allLinesSettled) return { approve: false, reason: "not_confident" };
  } else if (!settled(s.account, r?.account != null)) {
    return { approve: false, reason: "not_confident" };
  }

  // Tax only matters when the document actually showed some.
  if (s.taxTotal != null && !settled(s.taxCode, r?.taxCode != null)) {
    return { approve: false, reason: "not_confident" };
  }

  // A PAID document moves money through a specific bank account.
  //
  // Special-cased on purpose: suggestPaymentAccount only ever returns a match
  // when the client's books hold exactly ONE usable account, so a non-null
  // match here is a certainty ("there is only one it could be") even though it
  // scores 0.6. Judging it by the confidence number would block every paid
  // receipt from ever going through untouched.
  const isPaid =
    s.direction === "income"
      ? effectiveIncomeMode(s, r) === "salesreceipt"
      : effectiveExpenseMode(s, r) === "purchase";
  if (isPaid && !s.paymentAccount?.match && r?.paymentAccount == null) {
    return { approve: false, reason: "not_confident" };
  }

  return { approve: true };
}
