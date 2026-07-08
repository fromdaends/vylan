import { describe, it, expect } from "vitest";
import {
  effectiveMapping,
  effectiveDate,
  draftNeedsInput,
  effectiveExpenseMode,
  effectiveSplit,
  effectiveLines,
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

describe("effectiveDate", () => {
  it("prefers the accountant's override, else the AI date, else null", () => {
    expect(effectiveDate(sugg({ date: "2024-03-14" }), null)).toBe("2024-03-14");
    expect(
      effectiveDate(sugg({ date: "2024-03-14" }), {
        party: null,
        account: null,
        taxCode: null,
        date: "2024-05-01",
      }),
    ).toBe("2024-05-01");
    expect(effectiveDate(sugg({ date: null }), null)).toBeNull();
  });
});

describe("draftNeedsInput", () => {
  it("needs input while the account is unchosen", () => {
    expect(draftNeedsInput(sugg(), null)).toBe(true);
  });

  it("needs input when there is no date (else it would post dated 'today')", () => {
    const full: ResolvedEntry = {
      party: null,
      account: { id: "a1", name: "Supplies" },
      taxCode: null,
    };
    // otherwise-complete, but no date anywhere -> blocked
    expect(draftNeedsInput(sugg({ date: null }), full)).toBe(true);
    // fixed by the accountant supplying a date
    expect(
      draftNeedsInput(sugg({ date: null }), { ...full, date: "2024-05-01" }),
    ).toBe(false);
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

const withLines = (over: Partial<TransactionSuggestion> = {}) =>
  sugg({
    lines: [
      { description: "Drill", amount: 60, account: matched("a1", "Supplies") },
      { description: "Fuel", amount: 40, account: noMatch },
    ],
    ...over,
  });

describe("effectiveSplit + effectiveLines", () => {
  it("is not split by default (single line, no behavior change)", () => {
    expect(effectiveSplit(withLines(), null)).toBe(false);
  });
  it("splits only when opted in AND ≥2 lines", () => {
    expect(
      effectiveSplit(withLines(), {
        party: null,
        account: null,
        taxCode: null,
        split: true,
      }),
    ).toBe(true);
    // Fewer than 2 lines can't split even if opted in.
    expect(
      effectiveSplit(sugg({ lines: [] }), {
        party: null,
        account: null,
        taxCode: null,
        split: true,
      }),
    ).toBe(false);
  });
  it("income never splits", () => {
    expect(
      effectiveSplit(withLines({ direction: "income" }), {
        party: null,
        account: null,
        taxCode: null,
        split: true,
      }),
    ).toBe(false);
  });
  it("effectiveLines uses the AI account, then the per-line override", () => {
    const eff = effectiveLines(withLines(), null);
    expect(eff[0]!.account).toEqual({ id: "a1", name: "Supplies" }); // AI match
    expect(eff[1]!.account).toBeNull(); // AI had no match
    const overridden = effectiveLines(withLines(), {
      party: null,
      account: null,
      taxCode: null,
      lineAccounts: { "1": { id: "a2", name: "Fuel Exp" } },
    });
    expect(overridden[1]!.account).toEqual({ id: "a2", name: "Fuel Exp" });
  });
  it("a split draft needs EVERY line's account", () => {
    const s = withLines();
    const split: ResolvedEntry = {
      party: { id: "v1", name: "X" },
      account: null,
      taxCode: { id: "t1", name: "GST" },
      split: true,
    };
    // Line 2 (Fuel) has no account -> needs input.
    expect(draftNeedsInput(s, split)).toBe(true);
    // Fill it -> satisfied.
    expect(
      draftNeedsInput(s, {
        ...split,
        lineAccounts: { "1": { id: "a2", name: "Fuel Exp" } },
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
  it("is always 'bill' for income AND unknown direction (Purchase is expense-only)", () => {
    expect(
      effectiveExpenseMode(sugg({ direction: "income", paid: true }), null),
    ).toBe("bill");
    // Unknown-direction + AI paid=true must NOT become a Purchase (there is no UI
    // to set the paid-from account for it -> it would be stuck non-approvable).
    expect(
      effectiveExpenseMode(sugg({ direction: "unknown", paid: true }), null),
    ).toBe("bill");
  });
  it("an unknown+paid draft doesn't demand a paid-from account", () => {
    const s = sugg({ direction: "unknown", paid: true });
    expect(
      draftNeedsInput(s, {
        party: { id: "v1", name: "X" },
        account: { id: "a1", name: "Supplies" },
        taxCode: { id: "t1", name: "GST" },
      }),
    ).toBe(false);
  });
});
