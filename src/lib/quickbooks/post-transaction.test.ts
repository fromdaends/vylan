import { describe, it, expect } from "vitest";
import { buildBillPayload, checkBillPostable } from "./post-transaction";
import type { QuickbooksLists } from "./read";

describe("buildBillPayload", () => {
  it("builds a minimal valid Bill with a single expense line", () => {
    const bill = buildBillPayload({
      vendorId: "v1",
      accountId: "a1",
      amount: 97.7,
      date: "2026-02-18",
      memo: "Posted from Vylan",
    });
    expect(bill).toEqual({
      VendorRef: { value: "v1" },
      TxnDate: "2026-02-18",
      PrivateNote: "Posted from Vylan",
      Line: [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: 97.7,
          AccountBasedExpenseLineDetail: { AccountRef: { value: "a1" } },
        },
      ],
    });
  });
  it("rounds the amount to 2 decimals", () => {
    const bill = buildBillPayload({
      vendorId: "v1",
      accountId: "a1",
      amount: 10.005,
      date: null,
    });
    const line = (bill.Line as Array<{ Amount: number }>)[0];
    expect(line.Amount).toBe(10.01);
  });
  it("omits TxnDate when no date and omits PrivateNote when no memo", () => {
    const bill = buildBillPayload({
      vendorId: "v1",
      accountId: "a1",
      amount: 5,
      date: null,
    });
    expect("TxnDate" in bill).toBe(false);
    expect("PrivateNote" in bill).toBe(false);
  });
});

const lists = (over: Partial<QuickbooksLists> = {}): QuickbooksLists => ({
  accounts: [{ id: "a1", name: "Supplies", active: true, accountType: "Expense" }],
  vendors: [{ id: "v1", name: "Home Depot", active: true }],
  customers: [],
  taxCodes: [],
  ...over,
});

describe("checkBillPostable", () => {
  const ok = {
    direction: "expense",
    party: { id: "v1", name: "Home Depot" },
    account: { id: "a1", name: "Supplies" },
    amount: 97.7,
  };

  it("a complete active expense is postable (no problems)", () => {
    expect(checkBillPostable({ ...ok, lists: lists() })).toEqual([]);
  });
  it("rejects income / unknown direction", () => {
    expect(checkBillPostable({ ...ok, direction: "income", lists: lists() })).toContain(
      "not_expense",
    );
    expect(checkBillPostable({ ...ok, direction: "unknown", lists: lists() })).toContain(
      "not_expense",
    );
  });
  it("flags a missing vendor / account / amount", () => {
    expect(
      checkBillPostable({ ...ok, party: null, lists: lists() }),
    ).toContain("missing_vendor");
    expect(
      checkBillPostable({ ...ok, account: null, lists: lists() }),
    ).toContain("missing_account");
    expect(checkBillPostable({ ...ok, amount: null, lists: lists() })).toContain(
      "missing_amount",
    );
    expect(checkBillPostable({ ...ok, amount: 0, lists: lists() })).toContain(
      "missing_amount",
    );
  });
  it("flags a vendor archived in QuickBooks since approval", () => {
    const archived = lists({ vendors: [{ id: "v1", name: "Home Depot", active: false }] });
    expect(checkBillPostable({ ...ok, lists: archived })).toContain(
      "vendor_inactive",
    );
  });
  it("flags a vendor that no longer exists in the lists", () => {
    const gone = lists({ vendors: [{ id: "other", name: "X", active: true }] });
    expect(checkBillPostable({ ...ok, lists: gone })).toContain("vendor_inactive");
  });
  it("flags an inactive account", () => {
    const archived = lists({
      accounts: [{ id: "a1", name: "Supplies", active: false, accountType: "Expense" }],
    });
    expect(checkBillPostable({ ...ok, lists: archived })).toContain(
      "account_inactive",
    );
  });
  it("skips active checks when the lists aren't available (live API is the backstop)", () => {
    expect(checkBillPostable({ ...ok, lists: null })).toEqual([]);
  });
});
