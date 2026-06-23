// QuickBooks — engagement-level draft roll-up (pure).
//
// Summarizes all the draft suggestions on an engagement so the accountant gets a
// one-line "here's what I drafted" at the top of the checklist. Pure + tested.
//
// "needsInput" now counts drafts that still need the accountant before they
// could be posted, taking their RESOLVED picks into account (Stage 4): a draft
// where they've chosen the vendor, account, and tax code no longer counts. The
// account IS counted now that it's editable — every draft genuinely needs one.
//
// Stage 4, Phase 2 adds review state. A DISMISSED draft is intentionally skipped,
// so it never counts as "needs input" and drops out of the pipeline total; an
// APPROVED draft is complete by construction. needsInput therefore only counts
// drafts still in the 'draft' state.

import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";
import { draftNeedsInput } from "./draft-resolve";
import { normalizeDraftStatus, type DraftStatus } from "./draft-status";

export type DraftItem = {
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
  // Defaults to 'draft' when absent (callers built before status existed).
  status?: DraftStatus | string | null;
};

export type DraftSummary = {
  total: number;
  needsInput: number;
  approved: number;
  dismissed: number;
  // Sum of amounts in CAD (or unspecified currency) across non-dismissed drafts;
  // null when there are none.
  totalCad: number | null;
  // True when at least one non-dismissed draft is in a non-CAD currency (so a
  // single total would be misleading).
  hasForeignCurrency: boolean;
};

export function summarizeDrafts(drafts: DraftItem[]): DraftSummary {
  let needsInput = 0;
  let approved = 0;
  let dismissed = 0;
  let totalCad = 0;
  let cadCount = 0;
  let hasForeignCurrency = false;

  for (const { suggestion: s, resolved, status } of drafts) {
    const state = normalizeDraftStatus(status ?? null);
    if (state === "approved") approved++;
    if (state === "dismissed") dismissed++;
    // A dismissed draft is skipped — it neither needs input nor counts toward the
    // pipeline total/currency mix.
    if (state === "dismissed") continue;
    if (state === "draft" && draftNeedsInput(s, resolved)) needsInput++;
    const foreign = s.currency != null && s.currency !== "CAD";
    if (foreign) hasForeignCurrency = true;
    if (!foreign && s.amount != null) {
      totalCad += s.amount;
      cadCount++;
    }
  }

  return {
    total: drafts.length,
    needsInput,
    approved,
    dismissed,
    totalCad: cadCount > 0 ? Math.round(totalCad * 100) / 100 : null,
    hasForeignCurrency,
  };
}
