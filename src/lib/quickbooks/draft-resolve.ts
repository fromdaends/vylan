// QuickBooks Stage 4 — effective mapping (pure).
//
// A draft has TWO layers: the AI `suggestion` (a starting point) and the
// accountant's `resolved` picks (what they actually chose). The EFFECTIVE value
// of each field is "what the accountant picked, else what the AI matched". This
// is the single source of truth the card displays and the roll-up counts, so
// editing a draft and reading it back always agree.

import type {
  TransactionSuggestion,
  ResolvedEntry,
  ResolvedRef,
} from "@/lib/quickbooks/suggest";

export type EffectiveMapping = {
  party: ResolvedRef | null;
  account: ResolvedRef | null;
  taxCode: ResolvedRef | null;
  // The product/service item for an income line (Invoice). Null for expenses.
  item: ResolvedRef | null;
};

function matchRef(
  m: { id: string; name: string } | null,
): ResolvedRef | null {
  return m ? { id: m.id, name: m.name } : null;
}

// The accountant's pick wins; otherwise fall back to the AI's confident match.
// `item` is defensive about older suggestions/resolved rows that predate income
// support (suggestion.item / resolved.item may be absent).
export function effectiveMapping(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): EffectiveMapping {
  return {
    party: resolved?.party ?? matchRef(suggestion.party.match),
    account: resolved?.account ?? matchRef(suggestion.account.match),
    taxCode: resolved?.taxCode ?? matchRef(suggestion.taxCode.match),
    item: resolved?.item ?? matchRef(suggestion.item?.match ?? null),
  };
}

// Does this draft still need the accountant's input before it could be posted?
// Party always matters; the "mapping target" differs by direction — an INCOME
// line needs an ITEM (Invoice lines post to an item), an expense needs an
// ACCOUNT (Bill lines post to an account). The tax code matters only when the
// document showed tax. A foreign currency or a missing total also flag. Used by
// the roll-up and to tint the card.
export function draftNeedsInput(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): boolean {
  const eff = effectiveMapping(suggestion, resolved);
  const hasTax = suggestion.taxTotal != null;
  const mappingMissing =
    suggestion.direction === "income" ? eff.item == null : eff.account == null;
  return (
    eff.party == null ||
    mappingMissing ||
    (hasTax && eff.taxCode == null) ||
    (suggestion.currency != null && suggestion.currency !== "CAD") ||
    suggestion.amount == null
  );
}
