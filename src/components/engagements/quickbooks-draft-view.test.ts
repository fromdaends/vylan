import { describe, it, expect } from "vitest";
import { deriveQuickbooksDraftView } from "./quickbooks-draft-view";
import type { TransactionSuggestion, MatchField } from "@/lib/quickbooks/suggest";

const noMatch: MatchField = { match: null, confidence: 0, candidates: [] };
const matched = (name: string, active = true): MatchField => ({
  match: { id: "x", name, active },
  confidence: 0.9,
  candidates: [{ id: "x", name, active, score: 0.9 }],
});
const ambiguous: MatchField = {
  match: null,
  confidence: 0,
  candidates: [
    { id: "a", name: "A", active: true, score: 0.7 },
    { id: "b", name: "B", active: true, score: 0.7 },
  ],
};

function suggestion(over: Partial<TransactionSuggestion> = {}): TransactionSuggestion {
  return {
    direction: "expense",
    partyKind: "vendor",
    party: matched("Home Depot"),
    account: noMatch,
    taxCode: matched("GST/QST"),
    amount: 114.98,
    subtotal: 100,
    taxTotal: 14.98,
    date: "2024-03-14",
    currency: "CAD",
    overallConfidence: 0.8,
    notes: [],
    ...over,
  };
}

describe("deriveQuickbooksDraftView", () => {
  it("maps a matched party to 'matched' and an unmatched account to 'none'", () => {
    const v = deriveQuickbooksDraftView(suggestion());
    expect(v.party.state).toBe("matched");
    expect(v.party.name).toBe("Home Depot");
    expect(v.account.state).toBe("none");
    expect(v.tax.state).toBe("matched");
    expect(v.hasTax).toBe(true);
  });

  it("flags an archived match", () => {
    const v = deriveQuickbooksDraftView(
      suggestion({ party: matched("Old Supplier", false) }),
    );
    expect(v.party.state).toBe("matched_archived");
    expect(v.party.name).toBe("Old Supplier");
  });

  it("maps candidates-but-no-match to 'ambiguous'", () => {
    const v = deriveQuickbooksDraftView(suggestion({ party: ambiguous }));
    expect(v.party.state).toBe("ambiguous");
    expect(v.party.name).toBeNull();
  });

  it("treats a taxless document as no-tax (tax state none, hasTax false)", () => {
    const v = deriveQuickbooksDraftView(
      suggestion({ taxTotal: null, taxCode: noMatch }),
    );
    expect(v.hasTax).toBe(false);
    expect(v.tax.state).toBe("none");
  });

  it("detects a foreign currency", () => {
    expect(deriveQuickbooksDraftView(suggestion({ currency: "USD" })).foreignCurrency).toBe(
      true,
    );
    expect(deriveQuickbooksDraftView(suggestion({ currency: "CAD" })).foreignCurrency).toBe(
      false,
    );
    expect(deriveQuickbooksDraftView(suggestion({ currency: null })).foreignCurrency).toBe(
      false,
    );
  });

  it("passes through scalar fields and readiness", () => {
    const v = deriveQuickbooksDraftView(suggestion());
    expect(v.amount).toBe(114.98);
    expect(v.subtotal).toBe(100);
    expect(v.taxTotal).toBe(14.98);
    expect(v.date).toBe("2024-03-14");
    expect(v.readiness).toBe(0.8);
    expect(v.partyKind).toBe("vendor");
    expect(v.direction).toBe("expense");
  });
});
