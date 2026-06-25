import { describe, it, expect } from "vitest";
import {
  DRAFT_STATUSES,
  normalizeDraftStatus,
  isDraftStatus,
  canTransitionDraft,
  canApproveDraft,
} from "./draft-status";
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

// A fully-matched (complete) draft by default; tests knock out a field.
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

describe("normalizeDraftStatus", () => {
  it("keeps the three known states", () => {
    expect(normalizeDraftStatus("draft")).toBe("draft");
    expect(normalizeDraftStatus("approved")).toBe("approved");
    expect(normalizeDraftStatus("dismissed")).toBe("dismissed");
  });
  it("falls back to draft for unknown / null", () => {
    expect(normalizeDraftStatus(null)).toBe("draft");
    expect(normalizeDraftStatus(undefined)).toBe("draft");
    expect(normalizeDraftStatus("review")).toBe("draft");
    expect(normalizeDraftStatus("")).toBe("draft");
  });
  it("DRAFT_STATUSES all normalise to themselves", () => {
    for (const s of DRAFT_STATUSES) expect(normalizeDraftStatus(s)).toBe(s);
  });
});

describe("isDraftStatus", () => {
  it("accepts only the known states", () => {
    expect(isDraftStatus("draft")).toBe(true);
    expect(isDraftStatus("approved")).toBe(true);
    expect(isDraftStatus("dismissed")).toBe(true);
    expect(isDraftStatus("posted")).toBe(true);
    expect(isDraftStatus("nope")).toBe(false);
    expect(isDraftStatus(null)).toBe(false);
    expect(isDraftStatus(2)).toBe(false);
  });
});

describe("canTransitionDraft — posted (Stage 5)", () => {
  it("the generic status route can never move to or from 'posted'", () => {
    // posting + undo go through the dedicated /post and /void routes, not here.
    expect(canTransitionDraft("approved", "posted")).toBe(false);
    expect(canTransitionDraft("posted", "approved")).toBe(false);
    expect(canTransitionDraft("posted", "draft")).toBe(false);
    expect(canTransitionDraft("draft", "posted")).toBe(false);
    expect(canTransitionDraft("posted", "dismissed")).toBe(false);
  });
  it("normalizes 'posted' to itself", () => {
    expect(normalizeDraftStatus("posted")).toBe("posted");
  });
});

describe("canTransitionDraft", () => {
  it("a fresh draft can be approved or dismissed", () => {
    expect(canTransitionDraft("draft", "approved")).toBe(true);
    expect(canTransitionDraft("draft", "dismissed")).toBe(true);
  });
  it("approved/dismissed can only reopen to draft", () => {
    expect(canTransitionDraft("approved", "draft")).toBe(true);
    expect(canTransitionDraft("dismissed", "draft")).toBe(true);
  });
  it("cannot jump approved <-> dismissed directly", () => {
    expect(canTransitionDraft("approved", "dismissed")).toBe(false);
    expect(canTransitionDraft("dismissed", "approved")).toBe(false);
  });
  it("rejects same-state no-ops", () => {
    expect(canTransitionDraft("draft", "draft")).toBe(false);
    expect(canTransitionDraft("approved", "approved")).toBe(false);
    expect(canTransitionDraft("dismissed", "dismissed")).toBe(false);
  });
});

describe("canApproveDraft", () => {
  it("a complete draft can be approved", () => {
    expect(canApproveDraft(sugg(), null)).toBe(true);
  });
  it("an incomplete draft (missing account) cannot", () => {
    expect(canApproveDraft(sugg({ account: noMatch }), null)).toBe(false);
  });
  it("resolving the missing field makes it approvable", () => {
    const resolved: ResolvedEntry = {
      party: null,
      account: { id: "a1", name: "Supplies" },
      taxCode: null,
    };
    expect(canApproveDraft(sugg({ account: noMatch }), resolved)).toBe(true);
  });
  it("a foreign currency blocks approval", () => {
    expect(canApproveDraft(sugg({ currency: "USD" }), null)).toBe(false);
  });
  it("a missing total blocks approval", () => {
    expect(canApproveDraft(sugg({ amount: null }), null)).toBe(false);
  });
});
