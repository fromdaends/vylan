import { describe, it, expect } from "vitest";
import { summarizeDrafts } from "./draft-summary";
import type { TransactionSuggestion, MatchField } from "./suggest";

const matched = (name: string): MatchField => ({
  match: { id: "x", name, active: true },
  confidence: 0.9,
  candidates: [],
});
const noMatch: MatchField = { match: null, confidence: 0, candidates: [] };

function draft(over: Partial<TransactionSuggestion> = {}): TransactionSuggestion {
  return {
    direction: "expense",
    partyKind: "vendor",
    party: matched("Home Depot"),
    account: noMatch,
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

describe("summarizeDrafts", () => {
  it("counts an empty set as all zeros", () => {
    expect(summarizeDrafts([])).toEqual({
      total: 0,
      needsInput: 0,
      totalCad: null,
      hasForeignCurrency: false,
    });
  });

  it("does NOT count a clean draft as needing input (account is excluded)", () => {
    // Account is unmatched (the normal case) but everything else resolved.
    const s = summarizeDrafts([draft()]);
    expect(s.total).toBe(1);
    expect(s.needsInput).toBe(0);
    expect(s.totalCad).toBe(100);
  });

  it("flags an unmatched vendor as needing input", () => {
    const s = summarizeDrafts([draft({ party: noMatch })]);
    expect(s.needsInput).toBe(1);
  });

  it("flags an unmatched tax (only when the doc had tax)", () => {
    expect(summarizeDrafts([draft({ taxCode: noMatch })]).needsInput).toBe(1);
    // No tax on the doc -> an unmatched tax code is NOT a problem.
    expect(
      summarizeDrafts([draft({ taxTotal: null, taxCode: noMatch })]).needsInput,
    ).toBe(0);
  });

  it("flags a missing amount and a foreign currency", () => {
    expect(summarizeDrafts([draft({ amount: null })]).needsInput).toBe(1);
    expect(summarizeDrafts([draft({ currency: "USD" })]).needsInput).toBe(1);
  });

  it("sums only CAD/unspecified amounts and flags mixed currency", () => {
    const s = summarizeDrafts([
      draft({ amount: 100, currency: "CAD" }),
      draft({ amount: 50, currency: null }),
      draft({ amount: 999, currency: "USD" }),
    ]);
    expect(s.total).toBe(3);
    expect(s.totalCad).toBe(150); // USD excluded
    expect(s.hasForeignCurrency).toBe(true);
  });

  it("returns null totalCad when every draft is foreign or amountless", () => {
    const s = summarizeDrafts([
      draft({ amount: 10, currency: "USD" }),
      draft({ amount: null }),
    ]);
    expect(s.totalCad).toBeNull();
  });

  it("rounds the CAD total to cents", () => {
    const s = summarizeDrafts([draft({ amount: 10.1 }), draft({ amount: 20.2 })]);
    expect(s.totalCad).toBe(30.3);
  });
});
