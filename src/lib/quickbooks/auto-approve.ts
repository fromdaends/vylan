// Should this draft approve itself?
//
// The point of the whole bookkeeping flow is that the accountant stops touching
// documents the system already knows how to code. Hubdoc's autosync and Dext's
// supplier rules both do this; ours can do it better, because we do not ask
// anyone to configure a rule — the system only auto-approves what it has
// already watched a human approve, the same way, several times.
//
// EVERYTHING HERE IS A REASON TO SAY NO. This is the one place in the product
// that acts on a client's books with nobody looking, so every condition is a
// veto and the default answer is "ask the human". Getting a false negative
// costs one click; a false positive puts a wrong number in real books and
// nobody finds out until the return.
//
// PURE — no I/O, fully unit-tested. The caller gathers the inputs.

import { canApproveDraft } from "@/lib/quickbooks/draft-status";
import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";

// How many times a supplier must have been coded the SAME way, by a human,
// before the system will do it unattended.
//
// Three, not one: the first approval teaches the mapping, the second shows it
// was not a one-off, the third makes it a habit. One would auto-approve
// everything from a supplier after a single sighting, which is exactly how an
// early mistake becomes permanent and invisible.
export const AUTO_APPROVE_MIN_CONFIRMATIONS = 3;

export type AutoApproveInput = {
  // The firm turned this on. Off by default — nobody gets unattended approval
  // they did not ask for.
  enabled: boolean;
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
  // Which fields were filled from MEMORY rather than fuzzy-guessed.
  learnedFields: readonly string[];
  // Lowest confirmation count among the mappings this draft leaned on.
  timesConfirmed: number;
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
  | "not_expense"
  | "not_all_learned"
  | "not_confirmed_enough";

// The fields that must have come from memory before this draft can go through
// unattended. Tax only counts when the document actually showed tax.
function requiredLearnedFields(s: TransactionSuggestion): string[] {
  const required = [s.partyKind ?? "vendor", "expense_account"];
  if (s.taxTotal != null) required.push("tax");
  return required;
}

export function decideAutoApprove(
  input: AutoApproveInput,
): AutoApproveDecision {
  const { suggestion: s } = input;

  if (!input.enabled) return { approve: false, reason: "disabled" };

  // Checked early and on its own: a suspected duplicate is never auto-approved
  // no matter how well the rest of it scores.
  if (input.possibleDuplicate) {
    return { approve: false, reason: "possible_duplicate" };
  }

  // EXPENSES ONLY, deliberately. An income draft's posting target is the
  // product/service item, and items are not something we learn — so an income
  // draft can never satisfy "every field came from memory", and pretending
  // otherwise would auto-approve a guess. Income stays with the human until
  // item learning exists.
  if (s.direction !== "expense") {
    return { approve: false, reason: "not_expense" };
  }

  // Complete by exactly the same rule the Approve button uses — never a
  // parallel, looser definition of "ready".
  if (!canApproveDraft(s, input.resolved)) {
    return { approve: false, reason: "needs_input" };
  }

  // Every field that matters came from memory, not from a fuzzy name match.
  // This is the difference between "the system recognised this" and "the system
  // had a guess" — only the first is safe to act on unattended.
  const learned = new Set(input.learnedFields);
  if (!requiredLearnedFields(s).every((f) => learned.has(f))) {
    return { approve: false, reason: "not_all_learned" };
  }

  if (input.timesConfirmed < AUTO_APPROVE_MIN_CONFIRMATIONS) {
    return { approve: false, reason: "not_confirmed_enough" };
  }

  return { approve: true };
}
