import { describe, it, expect } from "vitest";
import {
  deriveNetAmount,
  resolveXeroTaxApplication,
  buildXeroBillPayload,
  buildXeroSpendPayload,
  buildXeroInvoicePayload,
  buildXeroReceivePayload,
  xeroTaxDiscrepancyNote,
  xeroPostingReference,
  xeroStatusNeedsDueDate,
  xeroUndoStatusFor,
  buildLineTracking,
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

  it("carries the line description + Reference through", () => {
    const body = buildXeroBillPayload({
      contactId: "C1",
      accountCode: "400",
      amount: 100,
      date: "2026-07-18",
      description: "Central Copiers — printer paper, toner",
      reference: "CC-20418",
    });
    expect(body.Reference).toBe("CC-20418");
    const lines = body.LineItems as Record<string, unknown>[];
    expect(lines[0].Description).toBe("Central Copiers — printer paper, toner");
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

describe("xeroPostingReference", () => {
  const FILE = "3f2b8c10-9a4d-4e21-8b77-1c0d5e6f7a89";

  it("passes a real document number through untouched", () => {
    expect(xeroPostingReference("INV-00123", FILE, "invoice")).toBe("INV-00123");
  });

  it("trims surrounding whitespace", () => {
    expect(xeroPostingReference("  INV-9  ", FILE, "invoice")).toBe("INV-9");
  });

  // The whole point: a bill with no number still traces back to the document.
  it("falls back to a traceable VYL- reference on an invoice", () => {
    expect(xeroPostingReference(null, FILE, "invoice")).toBe(`VYL-${FILE}`);
    expect(xeroPostingReference("", FILE, "invoice")).toBe(`VYL-${FILE}`);
    expect(xeroPostingReference("   ", FILE, "invoice")).toBe(`VYL-${FILE}`);
    expect(xeroPostingReference(undefined, FILE, "invoice")).toBe(
      `VYL-${FILE}`,
    );
  });

  // Deliberate: Xero's bank-reconciliation Find & Match reads Reference, so a
  // high-entropy token on a SPEND/RECEIVE would change how those firms
  // reconcile. Blank stays blank until that is walked through for real.
  it("does NOT invent a reference for a bank transaction", () => {
    expect(xeroPostingReference(null, FILE, "banktransaction")).toBeNull();
    expect(xeroPostingReference("   ", FILE, "banktransaction")).toBeNull();
  });

  it("still uses a real document number on a bank transaction", () => {
    expect(xeroPostingReference("RCPT-7", FILE, "banktransaction")).toBe(
      "RCPT-7",
    );
  });

  // Xero's limit is 255 — NOT the shared postingReference's 21 (QuickBooks'
  // DocNumber cap), which would have shredded the uuid.
  it("caps an overlong document number at Xero's 255", () => {
    const long = "X".repeat(300);
    const out = xeroPostingReference(long, FILE, "invoice");
    expect(out).toHaveLength(255);
  });

  it("keeps the whole file id — the fallback is well under the cap", () => {
    const out = xeroPostingReference(null, FILE, "invoice")!;
    expect(out.length).toBeLessThan(255);
    expect(out).toContain(FILE); // never truncated, so it stays searchable
  });
});

describe("publish status (Hubdoc 'Publish as')", () => {
  const bill = {
    contactId: "c1",
    accountCode: "400",
    amount: 100,
    date: "2024-03-14",
  };

  it("defaults to AUTHORISED — unchanged from before the picker existed", () => {
    expect(buildXeroBillPayload(bill).Status).toBe("AUTHORISED");
  });

  it("emits each of the three statuses", () => {
    expect(buildXeroBillPayload({ ...bill, status: "DRAFT" }).Status).toBe(
      "DRAFT",
    );
    expect(buildXeroBillPayload({ ...bill, status: "SUBMITTED" }).Status).toBe(
      "SUBMITTED",
    );
    expect(
      buildXeroBillPayload({ ...bill, status: "AUTHORISED" }).Status,
    ).toBe("AUTHORISED");
  });

  // Xero requires a DueDate on a bill that is (or is about to become)
  // authorised. A SUBMITTED bill is one approval click away, so it needs one.
  it("sets a DueDate for AUTHORISED and SUBMITTED, defaulting to the txn date", () => {
    expect(buildXeroBillPayload({ ...bill, status: "AUTHORISED" }).DueDate).toBe(
      "2024-03-14",
    );
    expect(buildXeroBillPayload({ ...bill, status: "SUBMITTED" }).DueDate).toBe(
      "2024-03-14",
    );
  });

  it("omits DueDate on a DRAFT with no due date on the document", () => {
    expect(buildXeroBillPayload({ ...bill, status: "DRAFT" }).DueDate).toBeUndefined();
  });

  it("still honours a real due date on a DRAFT", () => {
    expect(
      buildXeroBillPayload({ ...bill, status: "DRAFT", dueDate: "2024-04-30" })
        .DueDate,
    ).toBe("2024-04-30");
  });

  // A cash movement has no draft/approval state in Xero.
  it("never puts a Status on a spend bank transaction", () => {
    const spend = buildXeroSpendPayload({
      ...bill,
      bankAccountId: "bank-1",
    });
    expect(spend.Status).toBeUndefined();
  });
});

describe("xeroStatusNeedsDueDate", () => {
  it("is true for AUTHORISED and SUBMITTED, false for DRAFT", () => {
    expect(xeroStatusNeedsDueDate("AUTHORISED")).toBe(true);
    expect(xeroStatusNeedsDueDate("SUBMITTED")).toBe(true);
    expect(xeroStatusNeedsDueDate("DRAFT")).toBe(false);
  });
});

// The trap this whole posted_status column exists for: Xero REJECTS VOIDED on a
// draft or submitted invoice, so undo must send DELETED instead or the bill is
// stranded in the client's books with Vylan still showing "Posted".
describe("xeroUndoStatusFor", () => {
  it("deletes a draft or submitted bill", () => {
    expect(xeroUndoStatusFor("DRAFT")).toBe("DELETED");
    expect(xeroUndoStatusFor("SUBMITTED")).toBe("DELETED");
  });

  it("voids an authorised bill", () => {
    expect(xeroUndoStatusFor("AUTHORISED")).toBe("VOIDED");
  });

  // Rows posted before the column existed were always AUTHORISED.
  it("voids a legacy row with no recorded status", () => {
    expect(xeroUndoStatusFor(null)).toBe("VOIDED");
  });
});

describe("tracking categories", () => {
  const bill = {
    contactId: "c1",
    accountCode: "400",
    amount: 100,
    date: "2026-03-14",
  };
  const pair = { categoryId: "cat-dept", optionId: "opt-sales" };
  const second = { categoryId: "cat-loc", optionId: "opt-winnipeg" };
  const lineOf = (p: Record<string, unknown>) =>
    (p.LineItems as Record<string, unknown>[])[0]!;

  // An organisation that uses no tracking must not get a Tracking key at all.
  it("omits Tracking entirely when none is chosen", () => {
    expect(lineOf(buildXeroBillPayload(bill)).Tracking).toBeUndefined();
    expect(buildLineTracking(undefined)).toBeNull();
    expect(buildLineTracking([])).toBeNull();
  });

  // IDs, not names: a rename in Xero between our sync and the post would fail
  // with an opaque validation error if we sent names.
  it("sends category and option IDs, never names", () => {
    const t = lineOf(buildXeroBillPayload({ ...bill, tracking: [pair] }))
      .Tracking as Record<string, unknown>[];
    expect(t).toEqual([
      { TrackingCategoryID: "cat-dept", TrackingOptionID: "opt-sales" },
    ]);
  });

  it("carries both categories", () => {
    const t = lineOf(
      buildXeroBillPayload({ ...bill, tracking: [pair, second] }),
    ).Tracking as unknown[];
    expect(t).toHaveLength(2);
  });

  // Xero allows at most two ACTIVE categories per organisation.
  it("never sends more than two", () => {
    const t = lineOf(
      buildXeroBillPayload({
        ...bill,
        tracking: [pair, second, { categoryId: "x", optionId: "y" }],
      }),
    ).Tracking as unknown[];
    expect(t).toHaveLength(2);
  });

  it("applies to spend, sales invoices and receipts too", () => {
    expect(
      lineOf(
        buildXeroSpendPayload({ ...bill, bankAccountId: "b1", tracking: [pair] }),
      ).Tracking,
    ).toBeDefined();
    expect(
      lineOf(
        buildXeroInvoicePayload({
          contactId: "c1",
          itemCode: "DEV",
          accountCode: null,
          amount: 100,
          date: "2026-03-14",
          tracking: [pair],
        }),
      ).Tracking,
    ).toBeDefined();
    expect(
      lineOf(
        buildXeroReceivePayload({
          contactId: "c1",
          itemCode: "DEV",
          accountCode: null,
          bankAccountId: "b1",
          amount: 100,
          date: "2026-03-14",
          tracking: [pair],
        }),
      ).Tracking,
    ).toBeDefined();
  });

  // The categories describe the TRANSACTION, not the account it was carved
  // into, so a split expense carries the same tracking on every line.
  it("puts the same tracking on every line of a split", () => {
    const p = buildXeroBillPayload({
      ...bill,
      tax: { taxType: "GST", netAmount: 100 },
      lines: [
        { amount: 60, accountCode: "400" },
        { amount: 40, accountCode: "420" },
      ],
      tracking: [pair],
    });
    const lines = p.LineItems as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.Tracking).toEqual([
      { TrackingCategoryID: "cat-dept", TrackingOptionID: "opt-sales" },
    ]);
  });
});
