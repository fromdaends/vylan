import { describe, it, expect } from "vitest";
import {
  deriveNetAmount,
  resolveXeroTaxApplication,
  buildXeroBillPayload,
  buildXeroSpendPayload,
  buildXeroInvoicePayload,
  buildXeroReceivePayload,
  xeroTaxDiscrepancyNote,
} from "./post-transaction";

describe("deriveNetAmount", () => {
  it("prefers a positive subtotal", () => {
    expect(deriveNetAmount(150, 169.5, 19.5)).toBe(150);
  });
  it("falls back to total - tax when subtotal missing", () => {
    expect(deriveNetAmount(null, 169.5, 19.5)).toBe(150);
  });
  it("returns null when neither yields a positive net", () => {
    expect(deriveNetAmount(null, null, 19.5)).toBeNull();
    expect(deriveNetAmount(0, 19.5, 19.5)).toBeNull();
  });
});

describe("resolveXeroTaxApplication", () => {
  const base = { subtotal: 150, total: 169.5, taxTotal: 19.5 };
  it("returns net + TaxType when enabled with a code + tax", () => {
    expect(
      resolveXeroTaxApplication({ enabled: true, taxType: "OUTPUT2", ...base }),
    ).toEqual({ taxType: "OUTPUT2", netAmount: 150 });
  });
  it("returns null when disabled", () => {
    expect(
      resolveXeroTaxApplication({ enabled: false, taxType: "OUTPUT2", ...base }),
    ).toBeNull();
  });
  it("returns null with no document tax", () => {
    expect(
      resolveXeroTaxApplication({
        enabled: true,
        taxType: "OUTPUT2",
        subtotal: 150,
        total: 150,
        taxTotal: null,
      }),
    ).toBeNull();
  });
  it("returns null with no TaxType", () => {
    expect(
      resolveXeroTaxApplication({ enabled: true, taxType: null, ...base }),
    ).toBeNull();
  });
});

describe("buildXeroBillPayload (ACCPAY)", () => {
  it("posts NET + TaxType + Exclusive + defaulted DueDate when taxed", () => {
    const body = buildXeroBillPayload({
      contactId: "C1",
      accountCode: "400",
      amount: 169.5,
      date: "2026-07-18",
      tax: { taxType: "INPUT2", netAmount: 150 },
    });
    expect(body.Type).toBe("ACCPAY");
    expect(body.Contact).toEqual({ ContactID: "C1" });
    expect(body.LineAmountTypes).toBe("Exclusive");
    expect(body.Status).toBe("AUTHORISED");
    expect(body.DueDate).toBe("2026-07-18"); // defaults to txn date
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      AccountCode: "400",
      UnitAmount: 150,
      TaxType: "INPUT2",
      Quantity: 1,
    });
  });

  it("posts GROSS with NoTax and no TaxType when untaxed", () => {
    const body = buildXeroBillPayload({
      contactId: "C1",
      accountCode: "400",
      amount: 169.5,
      date: "2026-07-18",
    });
    expect(body.LineAmountTypes).toBe("NoTax");
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines[0]).toMatchObject({ AccountCode: "400", UnitAmount: 169.5 });
    expect(lines[0].TaxType).toBeUndefined();
  });

  it("honours a SPLIT (pre-tax lines) when taxed", () => {
    const body = buildXeroBillPayload({
      contactId: "C1",
      accountCode: "400",
      amount: 169.5,
      date: "2026-07-18",
      tax: { taxType: "INPUT2", netAmount: 150 },
      lines: [
        { amount: 90, accountCode: "400" },
        { amount: 60, accountCode: "420" },
      ],
    });
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.AccountCode)).toEqual(["400", "420"]);
    expect(lines.map((l) => l.UnitAmount)).toEqual([90, 60]);
    expect(lines.every((l) => l.TaxType === "INPUT2")).toBe(true);
  });

  it("posts a DRAFT (no forced DueDate) when asked", () => {
    const body = buildXeroBillPayload({
      contactId: "C1",
      accountCode: "400",
      amount: 100,
      date: "2026-07-18",
      status: "DRAFT",
    });
    expect(body.Status).toBe("DRAFT");
    expect(body.DueDate).toBeUndefined();
  });
});

describe("buildXeroSpendPayload (SPEND bank transaction)", () => {
  it("uses BankAccount.AccountID (GUID) and has no Status field", () => {
    const body = buildXeroSpendPayload({
      contactId: "C1",
      accountCode: "420",
      bankAccountId: "BANK-GUID-1",
      amount: 169.5,
      date: "2026-07-18",
      tax: { taxType: "INPUT2", netAmount: 150 },
    });
    expect(body.Type).toBe("SPEND");
    expect(body.BankAccount).toEqual({ AccountID: "BANK-GUID-1" });
    expect(body.LineAmountTypes).toBe("Exclusive");
    expect(body.Status).toBeUndefined();
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines[0]).toMatchObject({
      AccountCode: "420",
      UnitAmount: 150,
      TaxType: "INPUT2",
    });
  });
});

describe("buildXeroInvoicePayload (ACCREC)", () => {
  it("posts an item line with ItemCode + AccountCode and defaults DueDate", () => {
    const body = buildXeroInvoicePayload({
      contactId: "C9",
      itemCode: "SALES",
      accountCode: "200",
      amount: 113,
      date: "2026-07-01",
      tax: { taxType: "OUTPUT2", netAmount: 100 },
    });
    expect(body.Type).toBe("ACCREC");
    expect(body.DueDate).toBe("2026-07-01");
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines[0]).toMatchObject({
      ItemCode: "SALES",
      AccountCode: "200",
      UnitAmount: 100,
      TaxType: "OUTPUT2",
    });
  });

  it("omits ItemCode when there's only an account", () => {
    const body = buildXeroInvoicePayload({
      contactId: "C9",
      itemCode: null,
      accountCode: "200",
      amount: 100,
      date: "2026-07-01",
    });
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines[0].ItemCode).toBeUndefined();
    expect(lines[0].AccountCode).toBe("200");
    expect(body.LineAmountTypes).toBe("NoTax");
  });
});

describe("buildXeroReceivePayload (RECEIVE bank transaction)", () => {
  it("posts an income line against a bank account, no Status", () => {
    const body = buildXeroReceivePayload({
      contactId: "C9",
      itemCode: "SALES",
      accountCode: null,
      bankAccountId: "BANK-GUID-2",
      amount: 100,
      date: "2026-07-01",
    });
    expect(body.Type).toBe("RECEIVE");
    expect(body.BankAccount).toEqual({ AccountID: "BANK-GUID-2" });
    expect(body.Status).toBeUndefined();
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines[0].ItemCode).toBe("SALES");
  });
});

describe("xeroTaxDiscrepancyNote", () => {
  it("flags a total drift beyond tolerance", () => {
    const note = xeroTaxDiscrepancyNote({
      computedTax: 19.5,
      documentTax: 19.5,
      computedTotal: 175,
      documentTotal: 169.5,
    });
    expect(note).toContain("Xero recorded a total");
  });
  it("flags a tax drift when the total matches/absent", () => {
    const note = xeroTaxDiscrepancyNote({
      computedTax: 25,
      documentTax: 19.5,
      computedTotal: null,
      documentTotal: 169.5,
    });
    expect(note).toContain("of tax");
  });
  it("returns null within tolerance", () => {
    expect(
      xeroTaxDiscrepancyNote({
        computedTax: 19.5,
        documentTax: 19.51,
        computedTotal: 169.5,
        documentTotal: 169.5,
      }),
    ).toBeNull();
  });
});
