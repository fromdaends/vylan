// QuickBooks Stage 3, Phase 4 — engagement-level draft roll-up (pure).
//
// Summarizes all the draft suggestions on an engagement so the accountant gets a
// one-line "here's what I drafted" at the top of the checklist. Pure + tested.
//
// "needsInput" counts drafts where the AI couldn't resolve something it normally
// would — an unmatched vendor/customer, an unmatched tax on a taxed document, a
// foreign currency, or a missing total. It deliberately does NOT count the
// account: a receipt almost never names its expense account, so that's the
// accountant's call on EVERY draft and would make the number meaningless.

import type { TransactionSuggestion } from "@/lib/quickbooks/suggest";

export type DraftSummary = {
  total: number;
  needsInput: number;
  // Sum of amounts in CAD (or unspecified currency); null when there are none.
  totalCad: number | null;
  // True when at least one draft is in a non-CAD currency (so a single total
  // would be misleading).
  hasForeignCurrency: boolean;
};

export function summarizeDrafts(
  suggestions: TransactionSuggestion[],
): DraftSummary {
  let needsInput = 0;
  let totalCad = 0;
  let cadCount = 0;
  let hasForeignCurrency = false;

  for (const s of suggestions) {
    const foreign = s.currency != null && s.currency !== "CAD";
    // No confident party pick — counts whether the party row is unmatched OR the
    // direction itself was unidentifiable (partyKind null). The draft card always
    // shows a party warning in both cases, so the roll-up must agree.
    const partyUnresolved = s.party.match == null;
    const taxUnresolved = s.taxTotal != null && s.taxCode.match == null;
    const amountMissing = s.amount == null;
    if (partyUnresolved || taxUnresolved || foreign || amountMissing) {
      needsInput++;
    }
    if (foreign) hasForeignCurrency = true;
    if (!foreign && s.amount != null) {
      totalCad += s.amount;
      cadCount++;
    }
  }

  return {
    total: suggestions.length,
    needsInput,
    totalCad: cadCount > 0 ? Math.round(totalCad * 100) / 100 : null,
    hasForeignCurrency,
  };
}
