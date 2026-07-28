import { describe, it, expect } from "vitest";
import {
  decideAutoApprove,
  AUTO_APPROVE_MIN_CONFIDENCE,
  type AutoApproveInput,
} from "./auto-approve";
import type { TransactionSuggestion } from "./suggest";

// A confidently matched field. 1.0 is what an EXACT name match scores — the
// whole point being that this needs no prior teaching.
const sure = (id: string, name: string, confidence = 1) => ({
  match: { id, name, active: true },
  confidence,
  candidates: [],
});
// A fuzzy guess: the matcher picked something but is not sure.
const guess = (id: string, name: string) => ({
  match: { id, name, active: true },
  confidence: 0.82,
  candidates: [],
});
const none = { match: null, confidence: 0, candidates: [] };

function expense(over: Partial<TransactionSuggestion> = {}) {
  return {
    direction: "expense",
    partyKind: "vendor",
    party: sure("v1", "Home Depot"),
    account: sure("a1", "Supplies"),
    taxCode: sure("t1", "GST"),
    item: none,
    paymentAccount: none,
    amount: 114.98,
    subtotal: 100,
    taxTotal: 14.98,
    paid: false,
    lines: [],
    date: "2026-03-14",
    currency: "CAD",
    partySource: "Home Depot",
    taxSource: "GST",
    notes: [],
    ...over,
  } as unknown as TransactionSuggestion;
}

function income(over: Partial<TransactionSuggestion> = {}) {
  return expense({
    direction: "income",
    partyKind: "customer",
    party: sure("c1", "Eastside Club"),
    item: sure("i1", "Development work"),
    account: none,
    partySource: "Eastside Club",
    ...over,
  });
}

const input = (over: Partial<AutoApproveInput> = {}): AutoApproveInput => ({
  enabled: true,
  suggestion: expense(),
  resolved: null,
  possibleDuplicate: false,
  ...over,
});

describe("decideAutoApprove", () => {
  // THE HEADLINE. No prior teaching, nothing learned — the names simply match
  // what is already in the client's books, so there is nothing to ask about.
  it("approves a first-ever document whose fields all match exactly", () => {
    expect(decideAutoApprove(input())).toEqual({ approve: true });
  });

  // The founder's case: an invoice whose customer already exists in Xero under
  // that exact name should not sit there asking "pick a customer".
  it("approves income when the customer already exists by name", () => {
    expect(decideAutoApprove(input({ suggestion: income() }))).toEqual({
      approve: true,
    });
  });

  it("is OFF unless the firm turned it on", () => {
    expect(decideAutoApprove(input({ enabled: false }))).toEqual({
      approve: false,
      reason: "disabled",
    });
  });

  it("never auto-approves a suspected duplicate, however confident", () => {
    expect(decideAutoApprove(input({ possibleDuplicate: true }))).toEqual({
      approve: false,
      reason: "possible_duplicate",
    });
  });

  it("refuses when we cannot tell money in from money out", () => {
    expect(
      decideAutoApprove(input({ suggestion: expense({ direction: "unknown" }) })),
    ).toEqual({ approve: false, reason: "unknown_direction" });
  });

  describe("a guess is not a match", () => {
    it("refuses a fuzzily-matched vendor", () => {
      expect(
        decideAutoApprove(
          input({ suggestion: expense({ party: guess("v9", "Home Depo") }) }),
        ),
      ).toEqual({ approve: false, reason: "not_confident" });
    });

    it("refuses a fuzzily-matched expense account", () => {
      expect(
        decideAutoApprove(
          input({ suggestion: expense({ account: guess("a9", "Sundries") }) }),
        ),
      ).toEqual({ approve: false, reason: "not_confident" });
    });

    it("refuses a fuzzily-matched tax code when the document showed tax", () => {
      expect(
        decideAutoApprove(
          input({ suggestion: expense({ taxCode: guess("t9", "GST-ish") }) }),
        ),
      ).toEqual({ approve: false, reason: "not_confident" });
    });

    it("refuses a fuzzily-matched product on income", () => {
      expect(
        decideAutoApprove(
          input({ suggestion: income({ item: guess("i9", "Consulting") }) }),
        ),
      ).toEqual({ approve: false, reason: "not_confident" });
    });
  });

  // A learned mapping scores exactly at the bar, so teaching still unlocks the
  // fields that were never going to match by name.
  it("accepts a learned mapping (0.99), the value the bar is set to", () => {
    expect(AUTO_APPROVE_MIN_CONFIDENCE).toBe(0.99);
    expect(
      decideAutoApprove(
        input({
          suggestion: expense({ account: sure("a1", "Supplies", 0.99) }),
        }),
      ),
    ).toEqual({ approve: true });
  });

  it("rejects just below the bar", () => {
    expect(
      decideAutoApprove(
        input({ suggestion: expense({ account: sure("a1", "Supplies", 0.98) }) }),
      ),
    ).toEqual({ approve: false, reason: "not_confident" });
  });

  // The accountant's own pick outranks whatever the AI thought.
  it("treats a field the accountant chose by hand as settled", () => {
    expect(
      decideAutoApprove(
        input({
          suggestion: expense({ account: guess("a9", "Sundries") }),
          resolved: { account: { id: "a1", name: "Supplies" } } as never,
        }),
      ),
    ).toEqual({ approve: true });
  });

  it("does not need a tax code when the document showed no tax", () => {
    expect(
      decideAutoApprove(
        input({ suggestion: expense({ taxTotal: null, taxCode: none }) }),
      ),
    ).toEqual({ approve: true });
  });

  it("refuses anything still missing input", () => {
    expect(
      decideAutoApprove(input({ suggestion: expense({ account: none }) })),
    ).toEqual({ approve: false, reason: "needs_input" });
  });

  describe("paid documents need the bank account", () => {
    // suggestPaymentAccount only ever returns a match when the client's books
    // hold exactly ONE usable account, so a non-null match is a certainty even
    // though it scores 0.6 — judging it by the number would block every paid
    // receipt forever.
    it("accepts the single-candidate bank account despite its low score", () => {
      expect(
        decideAutoApprove(
          input({
            suggestion: expense({
              paid: true,
              paymentAccount: sure("b1", "Chequing", 0.6),
            }),
          }),
        ),
      ).toEqual({ approve: true });
    });

    it("refuses a paid document with no bank account at all", () => {
      expect(
        decideAutoApprove(
          input({ suggestion: expense({ paid: true, paymentAccount: none }) }),
        ),
      ).toEqual({ approve: false, reason: "needs_input" });
    });
  });

  describe("split expenses", () => {
    const split = (lineConf: number) =>
      expense({
        lines: [
          { description: "Paper", amount: 60, account: sure("a1", "Supplies") },
          {
            description: "Diesel",
            amount: 40,
            account: sure("a2", "Fuel", lineConf),
          },
        ],
      } as never);

    it("approves when every line account is settled", () => {
      expect(
        decideAutoApprove(
          input({
            suggestion: split(1),
            resolved: { split: true } as never,
          }),
        ),
      ).toEqual({ approve: true });
    });

    // A draft is only as settled as its least-settled line.
    it("refuses when ONE line account was guessed", () => {
      expect(
        decideAutoApprove(
          input({
            suggestion: split(0.8),
            resolved: { split: true } as never,
          }),
        ),
      ).toEqual({ approve: false, reason: "not_confident" });
    });
  });

  it("reports 'disabled' ahead of every other veto", () => {
    expect(
      decideAutoApprove(
        input({
          enabled: false,
          possibleDuplicate: true,
          suggestion: expense({ party: none }),
        }),
      ),
    ).toEqual({ approve: false, reason: "disabled" });
  });
});
