import { describe, it, expect } from "vitest";
import {
  effectiveMapping,
  effectiveDate,
  draftNeedsInput,
  effectiveExpenseMode,
  effectivePublishStatus,
  effectiveIncomeMode,
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

  it("coerces a non-ISO or impossible date to null (not postable)", () => {
    // The AI may return a date "as printed"; a hand-crafted resolved date could be
    // impossible. Neither is postable, so both read as null → the draft is blocked.
    expect(effectiveDate(sugg({ date: "03/14/2024" }), null)).toBeNull();
    expect(effectiveDate(sugg({ date: "March 14, 2024" }), null)).toBeNull();
    expect(effectiveDate(sugg({ date: "2024-13-40" }), null)).toBeNull();
    expect(effectiveDate(sugg({ date: "2024-02-30" }), null)).toBeNull();
    // A valid override still wins over a junk AI date.
    expect(
      effectiveDate(sugg({ date: "03/14/2024" }), {
        party: null,
        account: null,
        taxCode: null,
        date: "2024-05-01",
      }),
    ).toBe("2024-05-01");
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

  it("flags a foreign currency we cannot state, and a missing amount", () => {
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

describe("effectiveIncomeMode", () => {
  it("defaults to 'invoice' when paid is unknown (no behavior change)", () => {
    expect(
      effectiveIncomeMode(sugg({ direction: "income", paid: null }), null),
    ).toBe("invoice");
  });
  it("is 'salesreceipt' when the sale was read as paid", () => {
    expect(
      effectiveIncomeMode(sugg({ direction: "income", paid: true }), null),
    ).toBe("salesreceipt");
  });
  it("the accountant's override wins over the AI", () => {
    expect(
      effectiveIncomeMode(sugg({ direction: "income", paid: true }), {
        party: null,
        account: null,
        taxCode: null,
        paid: false,
      }),
    ).toBe("invoice");
    expect(
      effectiveIncomeMode(sugg({ direction: "income", paid: false }), {
        party: null,
        account: null,
        taxCode: null,
        paid: true,
      }),
    ).toBe("salesreceipt");
  });
  it("is always 'invoice' for expense AND unknown direction", () => {
    expect(
      effectiveIncomeMode(sugg({ direction: "expense", paid: true }), null),
    ).toBe("invoice");
    expect(
      effectiveIncomeMode(sugg({ direction: "unknown", paid: true }), null),
    ).toBe("invoice");
  });
});

describe("effectivePublishStatus (Xero 'Publish as')", () => {
  const unpaid = sugg({ paid: false });

  it("defaults to AUTHORISED — unchanged for anyone who never touches it", () => {
    expect(effectivePublishStatus(unpaid, null, null)).toBe("AUTHORISED");
    expect(effectivePublishStatus(unpaid, null, undefined)).toBe("AUTHORISED");
  });

  it("uses this client's remembered default when the document has no pick", () => {
    expect(effectivePublishStatus(unpaid, null, "SUBMITTED")).toBe("SUBMITTED");
    expect(effectivePublishStatus(unpaid, {} as never, "DRAFT")).toBe("DRAFT");
  });

  it("the accountant's pick for THIS document beats the client default", () => {
    expect(
      effectivePublishStatus(
        unpaid,
        { publishStatus: "DRAFT" } as never,
        "AUTHORISED",
      ),
    ).toBe("DRAFT");
  });

  // Xero's BankTransaction.Status only accepts AUTHORISED or DELETED — a cash
  // movement has no draft or approval state. The card hides the picker in this
  // mode; this is the backstop for a stale override left on a draft whose paid
  // toggle was flipped afterwards.
  it("forces AUTHORISED on a PAID expense, overriding everything", () => {
    const paid = sugg({ paid: true });
    expect(
      effectivePublishStatus(paid, { publishStatus: "DRAFT" } as never, "DRAFT"),
    ).toBe("AUTHORISED");
  });

  // A PAID SALE is a RECEIVE bank transaction — same rule as a paid expense.
  it("forces AUTHORISED on a paid SALE too", () => {
    const paidSale = {
      ...sugg({}),
      direction: "income" as const,
      paid: true,
    } as never;
    expect(
      effectivePublishStatus(paidSale, { publishStatus: "DRAFT" } as never, "DRAFT"),
    ).toBe("AUTHORISED");
  });

  // An UNPAID sale is an ACCREC invoice and DOES have the three states.
  it("honours the pick on an unpaid sale", () => {
    const unpaidSale = {
      ...sugg({}),
      direction: "income" as const,
      paid: false,
    } as never;
    expect(
      effectivePublishStatus(unpaidSale, { publishStatus: "SUBMITTED" } as never, null),
    ).toBe("SUBMITTED");
  });

  it("respects the paid-toggle override when deciding that", () => {
    // AI said unpaid, accountant marked it paid → bank transaction → AUTHORISED.
    expect(
      effectivePublishStatus(
        unpaid,
        { paid: true, publishStatus: "SUBMITTED" } as never,
        null,
      ),
    ).toBe("AUTHORISED");
  });
});

// Xero income posting: a PAID sale is a bank transaction, so it needs the
// account the money landed in — without it the post would fail at Xero rather
// than being caught while the accountant is still looking at the draft.
describe("draftNeedsInput — paid income needs a deposit account", () => {
  const income = (over: Record<string, unknown> = {}) =>
    ({
      ...sugg({}),
      direction: "income" as const,
      item: { match: { id: "i1", name: "Consulting" }, candidates: [] },
      taxTotal: null,
      ...over,
    }) as never;

  it("blocks a paid sale with no deposit account", () => {
    expect(draftNeedsInput(income({ paid: true }), null)).toBe(true);
  });

  it("passes once the deposit account is chosen", () => {
    expect(
      draftNeedsInput(income({ paid: true }), {
        paymentAccount: { id: "bank1", name: "Chequing" },
      } as never),
    ).toBe(false);
  });

  // An UNPAID sale is an ACCREC invoice — no bank account is involved at all,
  // which is why this half could ship with no extra input from the accountant.
  it("does NOT ask for one on an unpaid sale", () => {
    expect(draftNeedsInput(income({ paid: false }), null)).toBe(false);
  });
});

describe("draftNeedsInput — foreign currency blocks only when we cannot state it", () => {
  // The real question is not "is this CAD" but "can the post state the currency".
  // Xero records the organisation's currency on connect and sends an explicit
  // CurrencyCode; QuickBooks sends none, so it keeps the CAD assumption.
  // booksCurrency is set only on the path that CAN state one.
  const complete: ResolvedEntry = {
    party: null,
    account: { id: "a1", name: "Supplies" },
    taxCode: null,
  };

  it("lets a US receipt through on US books — the whole point", () => {
    // A US firm on USD books uploading a USD receipt. Before this, it parked at
    // "needs input" forever with no control anywhere that could clear it.
    expect(
      draftNeedsInput(
        sugg({ currency: "USD", booksCurrency: "USD" }),
        complete,
      ),
    ).toBe(false);
  });

  it("lets a CAD receipt through on US books — the post states CAD", () => {
    expect(
      draftNeedsInput(
        sugg({ currency: "CAD", booksCurrency: "USD" }),
        complete,
      ),
    ).toBe(false);
  });

  it("still blocks a foreign receipt when the books' currency is unknown", () => {
    // Nothing can state a currency here, so the amount would be recorded at face
    // value in whatever the books use. Unchanged behaviour, and the reason a
    // connection made before migration 1030 must reconnect.
    expect(draftNeedsInput(sugg({ currency: "USD" }), complete)).toBe(true);
    expect(
      draftNeedsInput(
        sugg({ currency: "USD", booksCurrency: null }),
        complete,
      ),
    ).toBe(true);
  });

  it("never blocks a CAD receipt on unknown books (the legacy assumption)", () => {
    expect(draftNeedsInput(sugg({ currency: "CAD" }), complete)).toBe(false);
  });

  it("never blocks when the document names no currency at all", () => {
    expect(
      draftNeedsInput(sugg({ currency: null, booksCurrency: "USD" }), complete),
    ).toBe(false);
    expect(draftNeedsInput(sugg({ currency: null }), complete)).toBe(false);
  });

  it("normalises the document's currency before comparing", () => {
    // Exercised against the CAD fallback, which is the only path that actually
    // compares strings — with booksCurrency set it short-circuits before this.
    expect(draftNeedsInput(sugg({ currency: " cad " }), complete)).toBe(false);
    expect(draftNeedsInput(sugg({ currency: "usd" }), complete)).toBe(true);
  });
});
