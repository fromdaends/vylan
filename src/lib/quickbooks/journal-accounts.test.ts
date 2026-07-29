import { describe, expect, it } from "vitest";
import {
  accountsForRole,
  blockedJournalAccounts,
  isJournalAccountAllowed,
  isSuggestedForRole,
  type TypedAccount,
} from "./journal-accounts";

// The Xero demo company's chart, which is what actually tripped this up.
const BANK: TypedAccount = { id: "b1", name: "Business Bank Account", type: "Bank" };
const SAVINGS: TypedAccount = {
  id: "b2",
  name: "Business Savings Account",
  type: "Bank",
};
const CARD: TypedAccount = { id: "c1", name: "Visa", type: "Credit Card" };
const SALES: TypedAccount = { id: "s1", name: "Sales", type: "Income" };
const FEES: TypedAccount = { id: "f1", name: "Bank Fees", type: "Expense" };
const CLEARING: TypedAccount = {
  id: "cl1",
  name: "Clearing Account",
  type: "CURRLIAB",
};

const ALL = [BANK, SAVINGS, CARD, SALES, FEES, CLEARING];
const typeMap = new Map(ALL.map((a) => [a.id, a.type]));

describe("isJournalAccountAllowed", () => {
  it("bars bank and credit-card accounts on Xero", () => {
    expect(isJournalAccountAllowed("xero", "Bank")).toBe(false);
    expect(isJournalAccountAllowed("xero", "Credit Card")).toBe(false);
    // Case is normalized, since the cache's casing has changed before.
    expect(isJournalAccountAllowed("xero", "BANK")).toBe(false);
  });

  it("allows everything else on Xero", () => {
    for (const t of ["Income", "Expense", "CURRENT", "CURRLIAB", "EQUITY", null]) {
      expect(isJournalAccountAllowed("xero", t)).toBe(true);
    }
  });

  it("allows everything on QuickBooks, bank accounts included", () => {
    expect(isJournalAccountAllowed("quickbooks", "Bank")).toBe(true);
    expect(isJournalAccountAllowed("quickbooks", "Credit Card")).toBe(true);
  });
});

describe("blockedJournalAccounts", () => {
  it("names the bank accounts a Xero journal would be rejected for", () => {
    const blocked = blockedJournalAccounts(
      "xero",
      [BANK, SALES, SAVINGS],
      typeMap,
    );
    expect(blocked).toEqual(["Business Bank Account", "Business Savings Account"]);
  });

  it("is empty for a valid Xero entry", () => {
    expect(blockedJournalAccounts("xero", [CLEARING, SALES, FEES], typeMap)).toEqual(
      [],
    );
  });

  it("never blocks on QuickBooks", () => {
    expect(blockedJournalAccounts("quickbooks", [BANK, SALES], typeMap)).toEqual([]);
  });

  it("stays silent about accounts whose type it doesn't know", () => {
    // An account missing from the cache must not be reported — a false refusal
    // would block a legitimate entry with no way for the accountant around it.
    const blocked = blockedJournalAccounts(
      "xero",
      [{ id: "unknown", name: "Mystery" }, BANK],
      typeMap,
    );
    expect(blocked).toEqual(["Business Bank Account"]);
  });

  it("reports each account once even if it appears on two lines", () => {
    expect(blockedJournalAccounts("xero", [BANK, BANK], typeMap)).toEqual([
      "Business Bank Account",
    ]);
  });
});

describe("isSuggestedForRole", () => {
  it("suggests income for sales and refunds", () => {
    expect(isSuggestedForRole("sales", "xero", SALES)).toBe(true);
    expect(isSuggestedForRole("refunds", "xero", SALES)).toBe(true);
    // The mis-pick that started this: fees onto a revenue account.
    expect(isSuggestedForRole("fees", "xero", SALES)).toBe(false);
  });

  it("suggests expense for every fee-ish role", () => {
    for (const role of ["fees", "fee_tax", "adjustments"] as const) {
      expect(isSuggestedForRole(role, "xero", FEES)).toBe(true);
      expect(isSuggestedForRole(role, "xero", SALES)).toBe(false);
    }
    expect(
      isSuggestedForRole("fees", "xero", {
        id: "x",
        name: "Purchases",
        type: "Cost of Goods Sold",
      }),
    ).toBe(true);
  });

  it("suggests a clearing account for the deposit on Xero, not the bank", () => {
    expect(isSuggestedForRole("bank", "xero", CLEARING)).toBe(true);
    expect(isSuggestedForRole("bank", "xero", BANK)).toBe(false);
    expect(
      isSuggestedForRole("bank", "xero", {
        id: "s",
        name: "Suspense",
        type: "CURRLIAB",
      }),
    ).toBe(true);
  });

  it("suggests the real bank account for the deposit on QuickBooks", () => {
    expect(isSuggestedForRole("bank", "quickbooks", BANK)).toBe(true);
    expect(isSuggestedForRole("bank", "quickbooks", SALES)).toBe(false);
  });
});

describe("accountsForRole", () => {
  it("drops what Xero refuses and counts it", () => {
    const r = accountsForRole("bank", "xero", ALL);
    const names = [...r.suggested, ...r.others].map((a) => a.name);
    expect(names).not.toContain("Business Bank Account");
    expect(names).not.toContain("Business Savings Account");
    expect(names).not.toContain("Visa");
    expect(r.blocked).toBe(3);
  });

  it("puts the sensible accounts first without hiding the rest", () => {
    const r = accountsForRole("fees", "xero", ALL);
    expect(r.suggested.map((a) => a.name)).toEqual(["Bank Fees"]);
    // Sales is still reachable — the split is guidance, not a restriction.
    expect(r.others.map((a) => a.name)).toContain("Sales");
  });

  it("keeps bank accounts for QuickBooks", () => {
    const r = accountsForRole("bank", "quickbooks", ALL);
    expect(r.blocked).toBe(0);
    expect(r.suggested.map((a) => a.name)).toContain("Business Bank Account");
  });
});
