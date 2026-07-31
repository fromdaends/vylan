import { describe, it, expect } from "vitest";
import { chaseOverride } from "./chase-override";
import type { LedgerTxnRef } from "@/lib/db/receipt-chase";

const chased: LedgerTxnRef = {
  provider: "quickbooks",
  entity: "bill",
  txnId: "195",
  amount: 169.5,
  currency: "CAD",
  txnDate: "2026-07-30",
  vendorName: "Boreal Traiteur",
};

describe("chaseOverride", () => {
  it("attaches to the transaction the receipt was asked for", () => {
    expect(
      chaseOverride({ supplied: undefined, chased, postingTo: "quickbooks" }),
    ).toEqual({ action: "attach", qboId: "195", entity: "bill" });
  });

  it("leaves an ordinary upload alone", () => {
    expect(
      chaseOverride({ supplied: undefined, chased: null, postingTo: "quickbooks" }),
    ).toBeUndefined();
  });

  it("never overrules a human", () => {
    // The accountant looked at the candidates and said "no, create it". A chase
    // default must not quietly undo that.
    const supplied = { action: "create" } as const;
    expect(
      chaseOverride({ supplied, chased, postingTo: "quickbooks" }),
    ).toBe(supplied);
  });

  it("never overrules a human who picked a DIFFERENT transaction", () => {
    const supplied = { action: "attach", qboId: "999", entity: "purchase" } as const;
    expect(
      chaseOverride({ supplied, chased, postingTo: "quickbooks" }),
    ).toBe(supplied);
  });

  it("does NOT send a QuickBooks transaction id to Xero", () => {
    // The client switched providers between being asked and answering. Id 195
    // means nothing in Xero — or worse, means something unrelated.
    expect(
      chaseOverride({ supplied: undefined, chased, postingTo: "xero" }),
    ).toBeUndefined();
  });

  it("does NOT send a Xero transaction id to QuickBooks", () => {
    expect(
      chaseOverride({
        supplied: undefined,
        chased: { ...chased, provider: "xero" },
        postingTo: "quickbooks",
      }),
    ).toBeUndefined();
  });

  it("carries the entity through, since ids are unique only per type", () => {
    expect(
      chaseOverride({
        supplied: undefined,
        chased: { ...chased, entity: "purchase" },
        postingTo: "quickbooks",
      }),
    ).toEqual({ action: "attach", qboId: "195", entity: "purchase" });
  });
});
