import { describe, it, expect } from "vitest";
import { ledgerRefOfUncat, parseQuestionRef } from "./ledger-question";
import { parseLedgerRef } from "./receipt-chase";
import type { UncatTxn } from "@/lib/quickbooks/uncategorized";

const txn: UncatTxn = {
  qboId: "42",
  entity: "purchase",
  txnDate: "2026-07-03",
  totalAmt: 150,
  uncatAmt: 100,
  currency: "CAD",
  docNumber: null,
  partyName: "Costco",
  accountName: "Uncategorised Expense",
  memo: "COSTCO WHOLESALE #443",
  lineIds: ["1"],
};

describe("ledgerRefOfUncat", () => {
  it("stores the UNCODED amount, not the transaction total", () => {
    // The client is being asked about the part nobody coded. Showing them $150
    // when the question is about a $100 line invites an answer about the wrong
    // purchase.
    expect(ledgerRefOfUncat(txn).amount).toBe(100);
  });

  it("keeps enough to show a human what is being asked about", () => {
    expect(ledgerRefOfUncat(txn)).toEqual({
      provider: "quickbooks",
      entity: "purchase",
      txnId: "42",
      amount: 100,
      currency: "CAD",
      txnDate: "2026-07-03",
      vendorName: "Costco",
    });
  });

  it("carries the provider so a question can never cross ledgers", () => {
    expect(ledgerRefOfUncat(txn, "xero").provider).toBe("xero");
  });
});

describe("parseQuestionRef", () => {
  it("round-trips what ledgerRefOfUncat writes", () => {
    expect(parseQuestionRef(ledgerRefOfUncat(txn))).toEqual(
      ledgerRefOfUncat(txn),
    );
  });

  it("understands a deposit", () => {
    const deposit = parseQuestionRef({
      provider: "quickbooks",
      entity: "deposit",
      txnId: "77",
    });
    expect(deposit?.entity).toBe("deposit");
  });

  it("refuses anything malformed", () => {
    expect(parseQuestionRef(null)).toBeNull();
    expect(parseQuestionRef("nope")).toBeNull();
    expect(parseQuestionRef({ provider: "sage", entity: "bill", txnId: "1" })).toBeNull();
    expect(parseQuestionRef({ provider: "quickbooks", entity: "journal", txnId: "1" })).toBeNull();
    expect(parseQuestionRef({ provider: "quickbooks", entity: "bill" })).toBeNull();
  });
});

describe("the deposit reference stays invisible to the receipt-chase parser", () => {
  it("does not teach chase-override a new entity type", () => {
    // This is the whole reason this module has its own parser. receipt-chase's
    // parse feeds chase-override, which decides where a returned DOCUMENT gets
    // attached in the client's books. A deposit reference must read as
    // unparseable there, so any document routes down the ordinary create path
    // rather than being attached to an entity that path has never been tested
    // against.
    const depositRef = ledgerRefOfUncat({ ...txn, entity: "deposit" });
    expect(parseLedgerRef(depositRef)).toBeNull();
    // …while a purchase reference is understood by both, as it always was.
    expect(parseLedgerRef(ledgerRefOfUncat(txn))).not.toBeNull();
  });
});
