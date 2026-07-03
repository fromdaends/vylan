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
  // The bank/credit-card account a PAID expense (Purchase) was paid from. Null for
  // income and for unpaid expenses (Bills).
  paymentAccount: ResolvedRef | null;
};

function matchRef(m: { id: string; name: string } | null): ResolvedRef | null {
  return m ? { id: m.id, name: m.name } : null;
}

// The accountant's pick wins; otherwise fall back to the AI's confident match.
// `item` / `paymentAccount` are defensive about older suggestions/resolved rows
// that predate income / Purchase support (those fields may be absent).
export function effectiveMapping(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): EffectiveMapping {
  return {
    party: resolved?.party ?? matchRef(suggestion.party.match),
    account: resolved?.account ?? matchRef(suggestion.account.match),
    taxCode: resolved?.taxCode ?? matchRef(suggestion.taxCode.match),
    item: resolved?.item ?? matchRef(suggestion.item?.match ?? null),
    paymentAccount:
      resolved?.paymentAccount ??
      matchRef(suggestion.paymentAccount?.match ?? null),
  };
}

// How an EXPENSE should post: a PAID receipt is a QuickBooks "Purchase" (against a
// bank/credit-card account), an unpaid bill is a "Bill". The accountant's override
// wins; otherwise the AI's read; default to "bill" (today's behavior) when unknown
// so nothing silently changes for a document we can't classify. Income is never a
// Purchase; "purchase" only applies to expense/unknown directions.
export function effectiveExpenseMode(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null,
): "bill" | "purchase" {
  if (suggestion.direction === "income") return "bill"; // n/a for income
  const paid = resolved?.paid ?? suggestion.paid ?? false;
  return paid ? "purchase" : "bill";
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
  // Mapping target by direction: income needs an ITEM; an expense needs an
  // ACCOUNT, and when it's a PAID expense (Purchase) it ALSO needs the bank/credit-
  // card account it was paid from.
  let mappingMissing: boolean;
  if (suggestion.direction === "income") {
    mappingMissing = eff.item == null;
  } else {
    const isPurchase =
      effectiveExpenseMode(suggestion, resolved) === "purchase";
    mappingMissing =
      eff.account == null || (isPurchase && eff.paymentAccount == null);
  }
  return (
    eff.party == null ||
    mappingMissing ||
    (hasTax && eff.taxCode == null) ||
    (suggestion.currency != null && suggestion.currency !== "CAD") ||
    suggestion.amount == null
  );
}
