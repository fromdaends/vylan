import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate the register search from the network: quickbooksQuery is the only
// impure dependency.
vi.mock("@/lib/quickbooks/client", () => ({
  quickbooksQuery: vi.fn(),
}));

import {
  findRegisterCandidates,
  classifyRegisterMatch,
  shiftIsoDate,
  type RegisterCandidate,
  type RegisterSearch,
} from "./register-match";
import { quickbooksQuery } from "@/lib/quickbooks/client";

const mockQuery = vi.mocked(quickbooksQuery);
const ctx = { accessToken: "t", realmId: "r", environment: "sandbox" as const };

function purchaseRow(over: Record<string, unknown> = {}) {
  return {
    Id: "10",
    SyncToken: "2",
    TxnDate: "2026-07-03",
    TotalAmt: 45.2,
    DocNumber: "D1",
    EntityRef: { value: "V1", name: "TIM HORTONS #4821" },
    ...over,
  };
}

function candidate(over: Partial<RegisterCandidate> = {}): RegisterCandidate {
  return {
    qboId: "10",
    entity: "purchase",
    txnDate: "2026-07-03",
    totalAmt: 45.2,
    docNumber: "D1",
    vendorId: "V1",
    vendorName: "Tim Hortons",
    syncToken: "2",
    currency: null,
    ...over,
  };
}

function search(
  candidates: RegisterCandidate[],
  truncated = false,
): RegisterSearch {
  return { candidates, truncated };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shiftIsoDate", () => {
  it("shifts across month and year boundaries", () => {
    expect(shiftIsoDate("2026-07-01", -5)).toBe("2026-06-26");
    expect(shiftIsoDate("2026-06-28", 5)).toBe("2026-07-03");
    expect(shiftIsoDate("2026-01-02", -5)).toBe("2025-12-28");
    expect(shiftIsoDate("2026-02-27", 5)).toBe("2026-03-04");
  });
});

describe("findRegisterCandidates", () => {
  it("queries each entity over the date window and keeps only exact-amount rows", async () => {
    mockQuery.mockImplementation(async (_t, _r, sql) => {
      if (sql.includes("FROM Bill")) return { Bill: [] };
      return {
        Purchase: [
          purchaseRow(), // exact amount -> kept
          purchaseRow({ Id: "11", TotalAmt: 45.21 }), // a penny off -> dropped
          purchaseRow({ Id: "12", TotalAmt: 45.204 }), // sub-half-cent -> kept
          purchaseRow({ Id: "13", TotalAmt: null }), // no amount -> dropped
        ],
      };
    });

    const r = await findRegisterCandidates(ctx, {
      entities: ["bill", "purchase"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(),
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const sql = mockQuery.mock.calls[1]![2];
    expect(sql).toContain("FROM Purchase");
    expect(sql).toContain("TxnDate >= '2026-06-26'");
    expect(sql).toContain("TxnDate <= '2026-07-06'");
    expect(r.truncated).toBe(false);
    expect(r.candidates.map((c) => c.qboId)).toEqual(["10", "12"]);
    expect(r.candidates[0]).toMatchObject({
      entity: "purchase",
      vendorId: "V1",
      vendorName: "TIM HORTONS #4821",
      syncToken: "2",
      docNumber: "D1",
    });
  });

  it("excludes transactions Vylan itself posted", async () => {
    mockQuery.mockResolvedValue({
      Purchase: [purchaseRow(), purchaseRow({ Id: "99" })],
    });

    const r = await findRegisterCandidates(ctx, {
      entities: ["purchase"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(["10"]),
    });

    expect(r.candidates.map((c) => c.qboId)).toEqual(["99"]);
  });

  it("drops vendor REFUNDS (Purchase with Credit=true) even at the exact amount", async () => {
    mockQuery.mockResolvedValue({
      Purchase: [
        purchaseRow({ Id: "50" }), // a real expense -> kept
        purchaseRow({ Id: "51", Credit: true }), // a same-amount refund -> dropped
      ],
    });

    const r = await findRegisterCandidates(ctx, {
      entities: ["purchase"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(),
    });

    expect(r.candidates.map((c) => c.qboId)).toEqual(["50"]);
  });

  it("captures the transaction currency (multicurrency) and leaves it null otherwise", async () => {
    mockQuery.mockResolvedValue({
      Purchase: [
        purchaseRow({ Id: "60", CurrencyRef: { value: "USD", name: "US Dollar" } }),
        purchaseRow({ Id: "61" }), // no CurrencyRef -> single-currency company
      ],
    });

    const r = await findRegisterCandidates(ctx, {
      entities: ["purchase"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(),
    });

    expect(r.candidates.map((c) => c.currency)).toEqual(["USD", null]);
  });

  it("reads the party ref per entity (Bill -> VendorRef, Invoice -> CustomerRef)", async () => {
    mockQuery.mockImplementation(async (_t, _r, sql) => {
      if (sql.includes("FROM Bill")) {
        return {
          Bill: [
            purchaseRow({
              EntityRef: undefined,
              VendorRef: { value: "V9", name: "Bell Canada" },
            }),
          ],
        };
      }
      return {
        Invoice: [
          purchaseRow({
            Id: "20",
            EntityRef: undefined,
            CustomerRef: { value: "C1", name: "Acme Inc" },
          }),
        ],
      };
    });

    const bills = await findRegisterCandidates(ctx, {
      entities: ["bill"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(),
    });
    const invoices = await findRegisterCandidates(ctx, {
      entities: ["invoice"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(),
    });

    expect(bills.candidates[0]).toMatchObject({
      vendorId: "V9",
      vendorName: "Bell Canada",
      entity: "bill",
    });
    expect(invoices.candidates[0]).toMatchObject({
      vendorId: "C1",
      vendorName: "Acme Inc",
      entity: "invoice",
    });
  });

  it("reads SalesReceipt (paid income) candidates from the SalesReceipt table via CustomerRef", async () => {
    mockQuery.mockImplementation(async (_t, _r, sql) => {
      if (sql.includes("FROM SalesReceipt")) {
        return {
          SalesReceipt: [
            purchaseRow({
              Id: "30",
              EntityRef: undefined,
              CustomerRef: { value: "C9", name: "Lumen Studio" },
            }),
          ],
        };
      }
      return {};
    });

    const r = await findRegisterCandidates(ctx, {
      entities: ["salesreceipt"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(),
    });

    expect(mockQuery.mock.calls[0]![2]).toContain("FROM SalesReceipt");
    expect(r.candidates[0]).toMatchObject({
      qboId: "30",
      entity: "salesreceipt",
      vendorId: "C9",
      vendorName: "Lumen Studio",
    });
  });

  it("flags truncation when a query hits the page cap", async () => {
    const page = Array.from({ length: 1000 }, (_, i) =>
      purchaseRow({ Id: String(i), TotalAmt: 1 }),
    );
    mockQuery.mockResolvedValue({ Purchase: page });

    const r = await findRegisterCandidates(ctx, {
      entities: ["purchase"],
      date: "2026-07-01",
      windowDays: 5,
      amount: 45.2,
      excludeQboIds: new Set(),
    });

    expect(r.truncated).toBe(true);
    expect(r.candidates).toEqual([]);
  });

  it("propagates a query failure (the caller fails open)", async () => {
    mockQuery.mockRejectedValue(new Error("boom"));
    await expect(
      findRegisterCandidates(ctx, {
        entities: ["purchase"],
        date: "2026-07-01",
        windowDays: 5,
        amount: 45.2,
        excludeQboIds: new Set(),
      }),
    ).rejects.toThrow("boom");
  });
});

describe("classifyRegisterMatch", () => {
  const base = {
    draftEntity: "purchase" as const,
    draftVendorId: "V1",
    draftVendorNames: ["Tim Hortons", "Tim Hortons #4821"],
  };

  it("none when there are no candidates", () => {
    expect(classifyRegisterMatch({ ...base, search: search([]) })).toEqual({
      kind: "none",
    });
  });

  it("clear on exactly one same-entity candidate with the same vendor", () => {
    const c = candidate();
    expect(classifyRegisterMatch({ ...base, search: search([c]) })).toEqual({
      kind: "clear",
      candidate: c,
    });
  });

  it("clear when the candidate has no vendor at all (raw bank-feed accept)", () => {
    const c = candidate({ vendorId: null, vendorName: null });
    expect(
      classifyRegisterMatch({ ...base, search: search([c]) }).kind,
    ).toBe("clear");
  });

  it("clear when the vendor id differs but the name is clearly similar", () => {
    const c = candidate({ vendorId: "V2", vendorName: "TIM HORTONS 4821" });
    expect(
      classifyRegisterMatch({ ...base, search: search([c]) }).kind,
    ).toBe("clear");
  });

  it("confirm on two or more candidates", () => {
    expect(
      classifyRegisterMatch({
        ...base,
        search: search([candidate(), candidate({ qboId: "11" })]),
      }).kind,
    ).toBe("confirm");
  });

  it("confirm when the single candidate is a different entity type", () => {
    const c = candidate({ entity: "bill" });
    expect(
      classifyRegisterMatch({ ...base, search: search([c]) }).kind,
    ).toBe("confirm");
  });

  it("confirm when the candidate's vendor contradicts the receipt's", () => {
    const c = candidate({ vendorId: "V2", vendorName: "Home Depot" });
    expect(
      classifyRegisterMatch({ ...base, search: search([c]) }).kind,
    ).toBe("confirm");
  });

  it("confirm when the candidate names a different vendor id with no name to compare", () => {
    const c = candidate({ vendorId: "V2", vendorName: null });
    expect(
      classifyRegisterMatch({ ...base, search: search([c]) }).kind,
    ).toBe("confirm");
  });

  it("confirm when the search was truncated (candidates may be missing)", () => {
    expect(
      classifyRegisterMatch({
        ...base,
        search: search([candidate()], true),
      }).kind,
    ).toBe("confirm");
  });

  it("confirm when the single candidate carries a currency (multicurrency file)", () => {
    // Same amount + vendor as a clear match, but a stated currency means
    // TotalAmt may not be the home currency the draft posts in — never
    // auto-attach; the accountant confirms.
    const c = candidate({ currency: "USD" });
    expect(
      classifyRegisterMatch({ ...base, search: search([c]) }).kind,
    ).toBe("confirm");
  });
});
