import { describe, it, expect } from "vitest";
import { summarizeDrafts, type DraftItem } from "./draft-summary";
import type {
  TransactionSuggestion,
  MatchField,
  ResolvedEntry,
} from "./suggest";

const matched = (name: string): MatchField => ({
  match: { id: "x", name, active: true },
  confidence: 0.9,
  candidates: [],
});
const noMatch: MatchField = { match: null, confidence: 0, candidates: [] };

// Default: a fully-matched draft (party + account + tax all matched) so it needs
// NO input. Individual tests knock out a field to make it need input.
function sugg(over: Partial<TransactionSuggestion> = {}): TransactionSuggestion {
  return {
    direction: "expense",
    partyKind: "vendor",
    party: matched("Home Depot"),
    account: matched("Supplies"),
    taxCode: matched("GST/QST"),
    amount: 100,
    subtotal: 88,
    taxTotal: 12,
    date: "2024-03-14",
    currency: "CAD",
    overallConfidence: 0.8,
    notes: [],
    ...over,
  };
}
function item(
  suggestion: TransactionSuggestion,
  resolved: ResolvedEntry | null = null,
): DraftItem {
  return { suggestion, resolved };
}

describe("summarizeDrafts", () => {
  it("counts an empty set as all zeros", () => {
    expect(summarizeDrafts([])).toEqual({
      total: 0,
      needsInput: 0,
      totalCad: null,
      hasForeignCurrency: false,
    });
  });

  it("a fully-matched draft needs no input", () => {
    const s = summarizeDrafts([item(sugg())]);
    expect(s.total).toBe(1);
    expect(s.needsInput).toBe(0);
    expect(s.totalCad).toBe(100);
  });

  it("counts an unmatched ACCOUNT as needing input (now editable)", () => {
    expect(summarizeDrafts([item(sugg({ account: noMatch }))]).needsInput).toBe(
      1,
    );
  });

  it("clears the need once the accountant resolves the missing account", () => {
    const s = summarizeDrafts([
      item(sugg({ account: noMatch }), {
        party: null,
        account: { id: "a1", name: "Supplies" },
        taxCode: null,
      }),
    ]);
    expect(s.needsInput).toBe(0);
  });

  it("flags an unmatched vendor", () => {
    expect(summarizeDrafts([item(sugg({ party: noMatch }))]).needsInput).toBe(1);
  });

  it("flags an unmatched tax only when the doc had tax", () => {
    expect(summarizeDrafts([item(sugg({ taxCode: noMatch }))]).needsInput).toBe(
      1,
    );
    expect(
      summarizeDrafts([item(sugg({ taxTotal: null, taxCode: noMatch }))])
        .needsInput,
    ).toBe(0);
  });

  it("flags a missing amount and a foreign currency", () => {
    expect(summarizeDrafts([item(sugg({ amount: null }))]).needsInput).toBe(1);
    expect(summarizeDrafts([item(sugg({ currency: "USD" }))]).needsInput).toBe(1);
  });

  it("sums only CAD/unspecified amounts and flags mixed currency", () => {
    const s = summarizeDrafts([
      item(sugg({ amount: 100, currency: "CAD" })),
      item(sugg({ amount: 50, currency: null })),
      item(sugg({ amount: 999, currency: "USD" })),
    ]);
    expect(s.total).toBe(3);
    expect(s.totalCad).toBe(150); // USD excluded
    expect(s.hasForeignCurrency).toBe(true);
  });
});
