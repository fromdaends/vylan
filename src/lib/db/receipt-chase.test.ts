import { describe, it, expect } from "vitest";
import {
  ledgerRefOfGap,
  parseLedgerRef,
  type LedgerTxnRef,
} from "./receipt-chase";
import type { ReceiptGap } from "@/lib/quickbooks/receipt-gap";

const gap: ReceiptGap = {
  qboId: "195",
  entity: "bill",
  txnDate: "2026-07-30",
  totalAmt: 169.5,
  currency: "CAD",
  docNumber: "BT-5590",
  vendorId: "68",
  vendorName: "Boreal Traiteur",
  accountName: "Meals",
};

describe("ledgerRefOfGap", () => {
  it("keeps everything needed to attach later AND to show a human now", () => {
    expect(ledgerRefOfGap(gap)).toEqual({
      provider: "quickbooks",
      entity: "bill",
      txnId: "195",
      amount: 169.5,
      currency: "CAD",
      txnDate: "2026-07-30",
      vendorName: "Boreal Traiteur",
    });
  });

  it("carries the provider so a Xero chase cannot post to QuickBooks", () => {
    expect(ledgerRefOfGap(gap, "xero").provider).toBe("xero");
  });
});

describe("parseLedgerRef", () => {
  const ref: LedgerTxnRef = {
    provider: "quickbooks",
    entity: "bill",
    txnId: "195",
    amount: 169.5,
    currency: "CAD",
    txnDate: "2026-07-30",
    vendorName: "Boreal Traiteur",
  };

  it("round-trips a stored reference", () => {
    expect(parseLedgerRef(JSON.parse(JSON.stringify(ref)))).toEqual(ref);
  });

  it("reads an ordinary request item as 'not chasing anything'", () => {
    expect(parseLedgerRef(null)).toBeNull();
    expect(parseLedgerRef(undefined)).toBeNull();
  });

  // Everything below must fall back to null, because null routes the uploaded
  // document down the ORDINARY path (create a draft the accountant reviews).
  // Guessing at a half-written reference is the one outcome that could attach a
  // receipt to the wrong transaction in a client's books.
  it("refuses a reference with no transaction id", () => {
    expect(parseLedgerRef({ ...ref, txnId: "" })).toBeNull();
    expect(parseLedgerRef({ ...ref, txnId: 195 })).toBeNull();
  });

  it("refuses an unknown provider", () => {
    expect(parseLedgerRef({ ...ref, provider: "sage" })).toBeNull();
  });

  it("refuses an unknown entity", () => {
    expect(parseLedgerRef({ ...ref, entity: "invoice" })).toBeNull();
    expect(parseLedgerRef({ ...ref, entity: "journalentry" })).toBeNull();
  });

  it("refuses junk", () => {
    expect(parseLedgerRef("bill:195")).toBeNull();
    expect(parseLedgerRef(42)).toBeNull();
    expect(parseLedgerRef([])).toBeNull();
  });

  it("tolerates missing display context, since only the ids are load-bearing", () => {
    const parsed = parseLedgerRef({
      provider: "quickbooks",
      entity: "purchase",
      txnId: "7",
    });
    expect(parsed).toEqual({
      provider: "quickbooks",
      entity: "purchase",
      txnId: "7",
      amount: 0,
      currency: null,
      txnDate: null,
      vendorName: null,
    });
  });
});
