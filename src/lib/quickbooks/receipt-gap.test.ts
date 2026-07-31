import { describe, it, expect } from "vitest";
import {
  attachedTransactionKeys,
  rowToGap,
  sortGaps,
  gapKey,
  describeGapForClient,
  type ReceiptGap,
} from "./receipt-gap";

const attachable = (type: string, value: string) => ({
  Id: `100${value}`,
  FileName: "receipt.jpg",
  AttachableRef: [{ EntityRef: { type, value } }],
});

describe("attachedTransactionKeys", () => {
  it("finds the transactions that already carry a document", () => {
    const keys = attachedTransactionKeys([
      attachable("Bill", "42"),
      attachable("Purchase", "7"),
    ]);
    expect(keys.has("bill:42")).toBe(true);
    expect(keys.has("purchase:7")).toBe(true);
  });

  it("keeps Bill 42 and Purchase 42 apart", () => {
    // QuickBooks ids are unique PER TYPE. A set of bare ids would mark the
    // Purchase as supported because a Bill happened to share its number, and the
    // firm would never be told to chase it.
    const keys = attachedTransactionKeys([attachable("Bill", "42")]);
    expect(keys.has("bill:42")).toBe(true);
    expect(keys.has("purchase:42")).toBe(false);
  });

  it("handles one file linked to several transactions", () => {
    const keys = attachedTransactionKeys([
      {
        AttachableRef: [
          { EntityRef: { type: "Bill", value: "1" } },
          { EntityRef: { type: "Bill", value: "2" } },
        ],
      },
    ]);
    expect(keys.size).toBe(2);
  });

  it("ignores an attachment linked to nothing", () => {
    // Real companies accumulate these: a file uploaded and never attached.
    expect(attachedTransactionKeys([{ AttachableRef: [] }]).size).toBe(0);
    expect(attachedTransactionKeys([{}]).size).toBe(0);
  });

  it("survives malformed rows rather than throwing mid-scan", () => {
    const keys = attachedTransactionKeys([
      { AttachableRef: [{ EntityRef: { type: "Bill" } }] },
      { AttachableRef: [{ EntityRef: { value: "9" } }] },
      { AttachableRef: "nonsense" as unknown as [] },
    ]);
    expect(keys.size).toBe(0);
  });
});

describe("rowToGap", () => {
  const bill = (over: Record<string, unknown> = {}) => ({
    Id: "42",
    TxnDate: "2026-07-03",
    TotalAmt: 340.5,
    DocNumber: "INV-9",
    VendorRef: { value: "68", name: "Boreal Traiteur" },
    Line: [
      {
        AccountBasedExpenseLineDetail: { AccountRef: { name: "Meals" } },
      },
    ],
    ...over,
  });

  it("reports an expense with nothing attached", () => {
    const gap = rowToGap("Bill", bill(), new Set());
    expect(gap).toEqual({
      qboId: "42",
      entity: "bill",
      txnDate: "2026-07-03",
      totalAmt: 340.5,
      currency: null,
      docNumber: "INV-9",
      vendorId: "68",
      vendorName: "Boreal Traiteur",
      accountName: "Meals",
    });
  });

  it("stays silent when a receipt is already attached", () => {
    expect(rowToGap("Bill", bill(), new Set(["bill:42"]))).toBeNull();
  });

  it("does not treat a Bill's attachment as covering the same-numbered Purchase", () => {
    const p = rowToGap("Purchase", bill(), new Set(["bill:42"]));
    expect(p).not.toBeNull();
    expect(p!.entity).toBe("purchase");
  });

  it("never chases a receipt for a REFUND", () => {
    // Money coming back has no supplier receipt. QuickBooks stores it in the
    // Purchase table with a POSITIVE total, so nothing else distinguishes it.
    expect(rowToGap("Purchase", bill({ Credit: true }), new Set())).toBeNull();
  });

  it("skips zero-value entries", () => {
    expect(rowToGap("Bill", bill({ TotalAmt: 0 }), new Set())).toBeNull();
  });

  it("reads a Purchase's party from EntityRef, not VendorRef", () => {
    const gap = rowToGap(
      "Purchase",
      bill({ VendorRef: undefined, EntityRef: { value: "9", name: "Esso" } }),
      new Set(),
    );
    expect(gap!.vendorName).toBe("Esso");
  });

  it("carries the currency when the company has multicurrency on", () => {
    const gap = rowToGap(
      "Bill",
      bill({ CurrencyRef: { value: "USD" } }),
      new Set(),
    );
    expect(gap!.currency).toBe("USD");
  });

  it("still reports a gap when the party is unnamed", () => {
    // A raw bank-feed accept often has no vendor at all. That is MORE worth
    // chasing, not less — dropping it would hide the least explained entries.
    const gap = rowToGap("Bill", bill({ VendorRef: undefined }), new Set());
    expect(gap).not.toBeNull();
    expect(gap!.vendorName).toBeNull();
  });

  it("does not require an account to report a gap", () => {
    const gap = rowToGap("Bill", bill({ Line: [] }), new Set());
    expect(gap!.accountName).toBeNull();
  });
});

describe("sortGaps", () => {
  it("puts the largest amounts first", () => {
    const g = (totalAmt: number): ReceiptGap => ({
      qboId: String(totalAmt),
      entity: "bill",
      txnDate: "2026-07-01",
      totalAmt,
      currency: null,
      docNumber: null,
      vendorId: null,
      vendorName: null,
      accountName: null,
    });
    expect(sortGaps([g(10), g(4000), g(99)]).map((x) => x.totalAmt)).toEqual([
      4000, 99, 10,
    ]);
  });
});

describe("gapKey", () => {
  it("is case-insensitive on the entity so QuickBooks' casing cannot split it", () => {
    expect(gapKey("Bill", "42")).toBe(gapKey("bill", "42"));
  });
});

describe("describeGapForClient", () => {
  const gap: ReceiptGap = {
    qboId: "42",
    entity: "bill",
    txnDate: "2026-07-03",
    totalAmt: 340.5,
    currency: null,
    docNumber: null,
    vendorId: null,
    vendorName: "Costco",
    accountName: "Supplies",
  };

  it("says what the client would recognise", () => {
    expect(describeGapForClient(gap)).toBe("$340.50 at Costco on July 3, 2026");
  });

  it("does not shift the date for anyone west of UTC", () => {
    // Running an ISO calendar date through a Date object renders July 3 as
    // July 2 in Vancouver — telling the client about a purchase they did not
    // make that day.
    expect(describeGapForClient(gap)).toContain("July 3, 2026");
  });

  it("works when the books never recorded who it was", () => {
    expect(describeGapForClient({ ...gap, vendorName: null })).toBe(
      "$340.50 payment on July 3, 2026",
    );
  });

  it("names the currency when there is one", () => {
    expect(describeGapForClient({ ...gap, currency: "USD" })).toContain(
      "340.50 USD",
    );
  });

  it("speaks French", () => {
    expect(describeGapForClient(gap, { locale: "fr" })).toBe(
      "$340.50 chez Costco le 3 juillet 2026",
    );
  });

  it("copes with a missing date", () => {
    expect(describeGapForClient({ ...gap, txnDate: null })).toBe(
      "$340.50 at Costco",
    );
  });
});
