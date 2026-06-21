// Pure view-model for the read-only "QuickBooks draft" card (Stage 3, Phase 3).
//
// Turns a TransactionSuggestion (from the mapper) into a flat, locale-agnostic
// shape the card renders: each mapped field gets a STATE the UI maps to a label,
// colour, and icon. Keeping this pure (no JSX, no i18n) means the card stays
// presentational and this logic is unit-tested on its own.

import type { TransactionSuggestion, PartyKind } from "@/lib/quickbooks/suggest";

// matched         = a confident, active pick
// matched_archived = a confident pick that is archived in QuickBooks (warn)
// ambiguous       = candidates exist but none confident — accountant must choose
// none            = nothing to match against / no match found
export type DraftFieldState =
  | "matched"
  | "matched_archived"
  | "ambiguous"
  | "none";

export type DraftFieldView = {
  state: DraftFieldState;
  name: string | null; // the matched entity name, when state involves a match
  confidence: number; // 0..1
};

export type QuickbooksDraftView = {
  direction: "expense" | "income" | "unknown";
  partyKind: PartyKind | null;
  party: DraftFieldView;
  account: DraftFieldView;
  tax: DraftFieldView;
  hasTax: boolean; // did the document show any tax at all?
  amount: number | null;
  subtotal: number | null;
  taxTotal: number | null;
  date: string | null;
  currency: string | null;
  foreignCurrency: boolean; // currency is present and not CAD
  readiness: number; // 0..1 overall, for the small meter
};

function fieldView(
  match: { name: string; active: boolean } | null,
  confidence: number,
  hasCandidates: boolean,
): DraftFieldView {
  if (match) {
    return {
      state: match.active ? "matched" : "matched_archived",
      name: match.name,
      confidence,
    };
  }
  return {
    state: hasCandidates ? "ambiguous" : "none",
    name: null,
    confidence: 0,
  };
}

export function deriveQuickbooksDraftView(
  s: TransactionSuggestion,
): QuickbooksDraftView {
  const hasTax = s.taxTotal != null;
  return {
    direction: s.direction,
    partyKind: s.partyKind,
    party: fieldView(
      s.party.match,
      s.party.confidence,
      s.party.candidates.length > 0,
    ),
    account: fieldView(
      s.account.match,
      s.account.confidence,
      s.account.candidates.length > 0,
    ),
    // Tax only needs attention when the document actually showed tax.
    tax: hasTax
      ? fieldView(
          s.taxCode.match,
          s.taxCode.confidence,
          s.taxCode.candidates.length > 0,
        )
      : { state: "none", name: null, confidence: 0 },
    hasTax,
    amount: s.amount,
    subtotal: s.subtotal,
    taxTotal: s.taxTotal,
    date: s.date,
    currency: s.currency,
    foreignCurrency: s.currency != null && s.currency !== "CAD",
    readiness: s.overallConfidence,
  };
}
