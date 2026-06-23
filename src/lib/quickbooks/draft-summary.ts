// QuickBooks — engagement-level draft roll-up (pure).
//
// Summarizes all the draft suggestions on an engagement so the accountant gets a
// one-line "here's what I drafted" at the top of the checklist. Pure + tested.
//
// "needsInput" now counts drafts that still need the accountant before they
// could be posted, taking their RESOLVED picks into account (Stage 4): a draft
// where they've chosen the vendor, account, and tax code no longer counts. The
// account IS counted now that it's editable — every draft genuinely needs one.

import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";
import { draftNeedsInput } from "./draft-resolve";

export type DraftItem = {
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
};

export type DraftSummary = {
  total: number;
  needsInput: number;
  // Sum of amounts in CAD (or unspecified currency); null when there are none.
  totalCad: number | null;
  // True when at least one draft is in a non-CAD currency (so a single total
  // would be misleading).
  hasForeignCurrency: boolean;
};

export function summarizeDrafts(drafts: DraftItem[]): DraftSummary {
  let needsInput = 0;
  let totalCad = 0;
  let cadCount = 0;
  let hasForeignCurrency = false;

  for (const { suggestion: s, resolved } of drafts) {
    const foreign = s.currency != null && s.currency !== "CAD";
    if (draftNeedsInput(s, resolved)) needsInput++;
    if (foreign) hasForeignCurrency = true;
    if (!foreign && s.amount != null) {
      totalCad += s.amount;
      cadCount++;
    }
  }

  return {
    total: drafts.length,
    needsInput,
    totalCad: cadCount > 0 ? Math.round(totalCad * 100) / 100 : null,
    hasForeignCurrency,
  };
}
