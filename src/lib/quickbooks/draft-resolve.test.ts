import { describe, it, expect } from "vitest";
import {
  effectiveMapping,
  draftNeedsInput,
  effectiveExpenseMode,
} from "./draft-resolve";
import type {
  TransactionSuggestion,
  MatchField,
  ResolvedEntry,
} from "./suggest";

const matched = (id: string, name: string): MatchField => ({
  match: { id, name, active: true },
  confidence: 0.9,
  candidates: [],
});
const noMatch: MatchField = { match: null, confidence: 0, candidates: [] };

function sugg(
  over: Partial<TransactionSuggestion> = {},
): TransactionSuggestion {
  return {
    direction: "expense",
    partyKind: "vendor",
    party: matched("v1", "Home Depot"),
    account: noMatch,
    taxCode: matched("t1", "GST/QST"),
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

describe("effectiveMapping", () => {
  it("falls back to the AI match when nothing is resolved", () => {
    const eff = effectiveMapping(sugg(), null);
    expect(eff.party).toEqual({ id: "v1", name: "Home Depot" });
    expect(eff.account).toBeNull(); // AI didn't match an account
    expect(eff.taxCode).toEqual({ id: "t1", name: "GST/QST" });
  });

  it("the accountant's pick overrides the AI match", () => {
    const resolved: ResolvedEntry = {
      party: { id: "v9", name: "Hicks Hardware" },
      account: { id: "a1", name: "Supplies" },
      taxCode: null,
    };
    const eff = effectiveMapping(sugg(), resolved);
    expect(eff.party).toEqual({ id: "v9", name: "Hicks Hardware" });
    expect(eff.account).toEqual({ id: "a1", name: "Supplies" });
    // taxCode resolved is null -> falls back to the AI match.
    expect(eff.taxCode).toEqual({ id: "t1", name: "GST/QST" });
  });
});

describe("draftNeedsInput", () => {
  it("needs input while the account is unchosen", () => {
    expect(draftNeedsInput(sugg(), null)).toBe(true);
  });

  it("is satisfied once party + account + tax are all effective", () => {
    const resolved: ResolvedEntry = {
      party: null, // AI matched the vendor already
      account: { id: "a1", name: "Supplies" },
      taxCode: null, // AI matched the tax already
    };
    expect(draftNeedsInput(sugg(), resolved)).toBe(false);
  });

  it("ignores tax when the document had none", () => {
    const s = sugg({ taxTotal: null, taxCode: noMatch });
    expect(
      draftNeedsInput(s, {
        party: null,
        account: { id: "a1", name: "Supplies" },
        taxCode: null,
      }),
    ).toBe(false);
  });

  it("flags a foreign currency and a missing amount", () => {
    const full: ResolvedEntry = {
      party: null,
      account: { id: "a1", name: "Supplies" },
      taxCode: null,
    };
    expect(draftNeedsInput(sugg({ currency: "USD" }), full)).toBe(true);
    expect(draftNeedsInput(sugg({ amount: null }), full)).toBe(true);
  });

  it("a PAID expense (Purchase) also needs the paid-from account", () => {
    // Account chosen, but it's paid and no paymentAccount yet -> still needs input.
    const s = sugg({ paid: true });
    const resolvedNoPay: ResolvedEntry = {
      party: null,
      account: { id: "a1", name: "Supplies" },
      taxCode: null,
    };
    expect(draftNeedsInput(s, resolvedNoPay)).toBe(true);
    // Once the paid-from account is chosen, it's satisfied.
    expect(
      draftNeedsInput(s, {
        ...resolvedNoPay,
        paymentAccount: { id: "cc1", name: "Visa" },
      }),
    ).toBe(false);
  });
});

describe("effectiveExpenseMode", () => {
  it("defaults to 'bill' when paid is unknown (no behavior change)", () => {
    expect(effectiveExpenseMode(sugg({ paid: null }), null)).toBe("bill");
  });
  it("is 'purchase' when the AI read it as paid", () => {
    expect(effectiveExpenseMode(sugg({ paid: true }), null)).toBe("purchase");
  });
  it("the accountant's override wins over the AI", () => {
    expect(
      effectiveExpenseMode(sugg({ paid: true }), {
        party: null,
        account: null,
        taxCode: null,
        paid: false,
      }),
    ).toBe("bill");
    expect(
      effectiveExpenseMode(sugg({ paid: false }), {
        party: null,
        account: null,
        taxCode: null,
        paid: true,
      }),
    ).toBe("purchase");
  });
  it("is always 'bill' for income (a Purchase is expense-only)", () => {
    expect(
      effectiveExpenseMode(sugg({ direction: "income", paid: true }), null),
    ).toBe("bill");
  });
});
