import { describe, it, expect } from "vitest";
import {
  decideAutoApprove,
  AUTO_APPROVE_MIN_CONFIRMATIONS,
  type AutoApproveInput,
} from "./auto-approve";
import type { TransactionSuggestion } from "./suggest";

// A draft that is complete and fully remembered — the ONLY shape that should
// ever go through unattended. Every test below breaks exactly one thing.
function suggestion(over: Partial<TransactionSuggestion> = {}) {
  return {
    direction: "expense",
    partyKind: "vendor",
    party: { match: { id: "v1", name: "Home Depot" }, confidence: 0.99, candidates: [] },
    account: { match: { id: "a1", name: "Supplies" }, confidence: 0.99, candidates: [] },
    taxCode: { match: { id: "t1", name: "GST" }, confidence: 0.99, candidates: [] },
    item: { match: null, confidence: 0, candidates: [] },
    paymentAccount: { match: null, confidence: 0, candidates: [] },
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

function input(over: Partial<AutoApproveInput> = {}): AutoApproveInput {
  return {
    enabled: true,
    suggestion: suggestion(),
    resolved: null,
    learnedFields: ["vendor", "expense_account", "tax"],
    timesConfirmed: AUTO_APPROVE_MIN_CONFIRMATIONS,
    possibleDuplicate: false,
    ...over,
  };
}

describe("decideAutoApprove", () => {
  it("approves a complete, fully-remembered, repeatedly-confirmed expense", () => {
    expect(decideAutoApprove(input())).toEqual({ approve: true });
  });

  it("is OFF unless the firm turned it on", () => {
    expect(decideAutoApprove(input({ enabled: false }))).toEqual({
      approve: false,
      reason: "disabled",
    });
  });

  // Auto-approving a suspected duplicate is how the same invoice gets paid
  // twice. Dext never auto-publishes one either.
  it("never auto-approves a suspected duplicate, however good the rest is", () => {
    expect(decideAutoApprove(input({ possibleDuplicate: true }))).toEqual({
      approve: false,
      reason: "possible_duplicate",
    });
  });

  it("refuses anything still missing input", () => {
    const incomplete = suggestion({
      account: { match: null, confidence: 0, candidates: [] },
    } as never);
    expect(decideAutoApprove(input({ suggestion: incomplete }))).toEqual({
      approve: false,
      reason: "needs_input",
    });
  });

  // An income draft posts against a product/service item, and items are not a
  // thing we learn — so "every field came from memory" can never be true, and
  // approving one unattended would be approving a guess.
  it("refuses income entirely", () => {
    const income = suggestion({ direction: "income", partyKind: "customer" });
    expect(decideAutoApprove(input({ suggestion: income }))).toEqual({
      approve: false,
      reason: "not_expense",
    });
  });

  describe("every required field must come from MEMORY, not a guess", () => {
    it("refuses when the vendor was only fuzzy-matched", () => {
      expect(
        decideAutoApprove(
          input({ learnedFields: ["expense_account", "tax"] }),
        ),
      ).toEqual({ approve: false, reason: "not_all_learned" });
    });

    it("refuses when the account was only fuzzy-matched", () => {
      expect(
        decideAutoApprove(input({ learnedFields: ["vendor", "tax"] })),
      ).toEqual({ approve: false, reason: "not_all_learned" });
    });

    it("refuses when the document HAS tax but the tax code was guessed", () => {
      expect(
        decideAutoApprove(
          input({ learnedFields: ["vendor", "expense_account"] }),
        ),
      ).toEqual({ approve: false, reason: "not_all_learned" });
    });

    // A document with no tax has no tax code to remember, so requiring one
    // would block every zero-rated receipt forever.
    it("does not require a remembered tax code when there is no tax", () => {
      const noTax = suggestion({ taxTotal: null, taxCode: { match: null, confidence: 0, candidates: [] } } as never);
      expect(
        decideAutoApprove(
          input({
            suggestion: noTax,
            learnedFields: ["vendor", "expense_account"],
          }),
        ),
      ).toEqual({ approve: true });
    });

    it("matches the party kind — a customer mapping does not satisfy a vendor draft", () => {
      expect(
        decideAutoApprove(
          input({ learnedFields: ["customer", "expense_account", "tax"] }),
        ),
      ).toEqual({ approve: false, reason: "not_all_learned" });
    });
  });

  describe("confirmation threshold", () => {
    it("refuses below the threshold", () => {
      for (let n = 0; n < AUTO_APPROVE_MIN_CONFIRMATIONS; n++) {
        expect(decideAutoApprove(input({ timesConfirmed: n }))).toEqual({
          approve: false,
          reason: "not_confirmed_enough",
        });
      }
    });

    it("approves at and above the threshold", () => {
      expect(
        decideAutoApprove(
          input({ timesConfirmed: AUTO_APPROVE_MIN_CONFIRMATIONS }),
        ),
      ).toEqual({ approve: true });
      expect(decideAutoApprove(input({ timesConfirmed: 99 }))).toEqual({
        approve: true,
      });
    });

    // One sighting is how an early mistake becomes permanent and invisible.
    it("is more than one, deliberately", () => {
      expect(AUTO_APPROVE_MIN_CONFIRMATIONS).toBeGreaterThan(1);
    });
  });

  // Ordering matters for the reason reported back: a disabled firm should read
  // as disabled, not as some downstream failure.
  it("reports 'disabled' ahead of every other veto", () => {
    expect(
      decideAutoApprove(
        input({
          enabled: false,
          possibleDuplicate: true,
          timesConfirmed: 0,
          learnedFields: [],
        }),
      ),
    ).toEqual({ approve: false, reason: "disabled" });
  });
});
