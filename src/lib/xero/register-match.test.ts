import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/xero/client", () => ({
  xeroGet: vi.fn(),
  XeroError: class XeroError extends Error {
    code = "test";
  },
}));

import { xeroGet } from "@/lib/xero/client";
import {
  parseXeroDate,
  registerWindow,
  searchXeroRegister,
  checkXeroRegister,
  xeroSearchEntities,
} from "./register-match";

const get = vi.mocked(xeroGet);
const CTX = { accessToken: "tok", tenantId: "tenant-1" };

// Reply to the two register reads independently: the search fires both at once
// and a test usually cares about only one of them.
function reply(opts: {
  invoices?: Array<Record<string, unknown>>;
  bank?: Array<Record<string, unknown>>;
  failInvoices?: boolean;
  failBank?: boolean;
}) {
  get.mockImplementation(async (_tok: string, _tenant: string, path: string) => {
    if (path.startsWith("Invoices")) {
      if (opts.failInvoices) throw new Error("500 from Xero");
      return { Invoices: opts.invoices ?? [] };
    }
    if (opts.failBank) throw new Error("500 from Xero");
    return { BankTransactions: opts.bank ?? [] };
  });
}

const BILL = {
  InvoiceID: "inv-1",
  Type: "ACCPAY",
  Status: "AUTHORISED",
  Date: "2026-07-10T00:00:00",
  Total: 114.98,
  InvoiceNumber: "A-77",
  CurrencyCode: "CAD",
  Contact: { ContactID: "c-1", Name: "Staples" },
};

const EXPENSE_SEARCH = {
  date: "2026-07-10",
  amountCents: 11498,
  entities: xeroSearchEntities("expense"),
  // A Canadian document in a Canadian organisation — the ordinary case.
  documentCurrency: "CAD",
  orgCurrency: "CAD",
};

beforeEach(() => {
  get.mockReset();
});

describe("parseXeroDate — an unreadable date must never become today's", () => {
  it("reads Xero's /Date(ms)/ form", () => {
    // 2026-07-10T00:00:00Z
    expect(parseXeroDate("/Date(1783641600000+0000)/")).toBe("2026-07-10");
  });
  it("reads the plain ISO form", () => {
    expect(parseXeroDate("2026-07-10T00:00:00")).toBe("2026-07-10");
  });
  it("returns null for anything else", () => {
    expect(parseXeroDate("")).toBeNull();
    expect(parseXeroDate("last Tuesday")).toBeNull();
    expect(parseXeroDate(null)).toBeNull();
    expect(parseXeroDate(1783641600000)).toBeNull();
  });
});

describe("registerWindow", () => {
  it("brackets the date by ±5 days, crossing a month boundary", () => {
    expect(registerWindow("2026-07-02")).toEqual({
      from: "2026-06-27",
      to: "2026-07-07",
    });
  });
});

describe("searchXeroRegister", () => {
  it("finds a bill matching to the penny", async () => {
    reply({ invoices: [BILL] });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({
      qboId: "inv-1",
      entity: "bill",
      txnDate: "2026-07-10",
      totalAmt: 114.98,
      docNumber: "A-77",
      vendorId: "c-1",
      vendorName: "Staples",
    });
    expect(r.readFailed).toBe(false);
  });

  it("ignores an amount that is off by a cent", async () => {
    reply({ invoices: [{ ...BILL, Total: 114.99 }] });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates).toEqual([]);
  });

  it("never matches a VOIDED or DELETED transaction", async () => {
    // Attaching to one would leave the real expense unrecorded in the books.
    reply({
      invoices: [
        { ...BILL, InvoiceID: "v", Status: "VOIDED" },
        { ...BILL, InvoiceID: "d", Status: "DELETED" },
      ],
    });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates).toEqual([]);
  });

  it("only returns the draft's own direction", async () => {
    // A $114.98 sale on the same day as a $114.98 expense is a coincidence, not
    // a duplicate — surfacing it would train accountants to dismiss the dialog.
    reply({
      invoices: [{ ...BILL, InvoiceID: "sale", Type: "ACCREC" }],
      bank: [
        {
          BankTransactionID: "recv",
          Type: "RECEIVE",
          Status: "AUTHORISED",
          Date: "2026-07-10T00:00:00",
          Total: 114.98,
          CurrencyCode: "CAD",
          Contact: {},
        },
      ],
    });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates).toEqual([]);

    const income = await searchXeroRegister(CTX, {
      ...EXPENSE_SEARCH,
      entities: xeroSearchEntities("income"),
    });
    expect(income.candidates.map((c) => c.entity).sort()).toEqual([
      "invoice",
      "salesreceipt",
    ]);
  });

  it("searches BOTH registers on one side — a duplicate can be either shape", async () => {
    reply({
      invoices: [BILL],
      bank: [
        {
          BankTransactionID: "bt-1",
          Type: "SPEND",
          Status: "AUTHORISED",
          Date: "2026-07-09T00:00:00",
          Total: 114.98,
          Reference: "card",
          CurrencyCode: "CAD",
          Contact: {},
        },
      ],
    });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates.map((c) => c.entity).sort()).toEqual([
      "bill",
      "purchase",
    ]);
  });

  it("reports the posting currency as null so a match can clear", async () => {
    // Xero stamps CurrencyCode on EVERY transaction (QuickBooks only sets
    // CurrencyRef under multicurrency). Passing it through raw would make the
    // shared classifier ask on every single Xero match, forever.
    reply({ invoices: [BILL] });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates[0]!.currency).toBeNull();
  });

  it("keeps a FOREIGN currency code so the classifier asks", async () => {
    reply({ invoices: [{ ...BILL, CurrencyCode: "USD" }] });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates[0]!.currency).toBe("USD");
  });

  it("falls back to the organisation's currency when the document is silent", async () => {
    reply({ invoices: [BILL] });
    const r = await searchXeroRegister(CTX, {
      ...EXPENSE_SEARCH,
      documentCurrency: null,
    });
    expect(r.candidates[0]!.currency).toBeNull();
  });

  it("keeps every code when NEITHER currency is known", async () => {
    // A connection made before we recorded it, and a document that did not say
    // — err toward asking.
    reply({ invoices: [BILL] });
    const r = await searchXeroRegister(CTX, {
      ...EXPENSE_SEARCH,
      documentCurrency: null,
      orgCurrency: null,
    });
    expect(r.candidates[0]!.currency).toBe("CAD");
  });

  it("the DOCUMENT's currency decides, not the organisation's", async () => {
    // Found in the founder's own books: the Xero Demo Company (Global) is USD,
    // and a CAD receipt posted into it posts CAD. A USD 114.98 bill sitting in
    // the window is NOT the same money as a CAD 114.98 receipt, and comparing
    // against the ORGANISATION would have reported it as unambiguous and
    // attached the receipt to it.
    reply({ invoices: [{ ...BILL, CurrencyCode: "USD" }] });
    const r = await searchXeroRegister(CTX, {
      ...EXPENSE_SEARCH,
      documentCurrency: "CAD",
      orgCurrency: "USD",
    });
    expect(r.candidates[0]!.currency).toBe("USD");

    // ...and the same-currency candidate in that organisation still clears.
    reply({ invoices: [{ ...BILL, CurrencyCode: "CAD" }] });
    const same = await searchXeroRegister(CTX, {
      ...EXPENSE_SEARCH,
      documentCurrency: "CAD",
      orgCurrency: "USD",
    });
    expect(same.candidates[0]!.currency).toBeNull();
  });

  it("reports a failed read as readFailed AND truncated, never as 'clear'", async () => {
    reply({ failInvoices: true, failBank: true });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates).toEqual([]);
    expect(r.readFailed).toBe(true);
    expect(r.truncated).toBe(true);
  });

  it("still returns the register that DID respond, marked truncated", async () => {
    reply({ invoices: [BILL], failBank: true });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(r.readFailed).toBe(true);
  });

  it("marks a full page as truncated — the window may hold more", async () => {
    reply({
      invoices: Array.from({ length: 100 }, (_, i) => ({
        ...BILL,
        InvoiceID: `inv-${i}`,
        // Only one matches the amount; the PAGE being full is what matters.
        Total: i === 0 ? 114.98 : 1,
      })),
    });
    const r = await searchXeroRegister(CTX, EXPENSE_SEARCH);
    expect(r.candidates).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("asks Xero for the ±5 day window, not the whole ledger", async () => {
    reply({});
    await searchXeroRegister(CTX, EXPENSE_SEARCH);
    const path = get.mock.calls[0]![2];
    const where = decodeURIComponent(path.split("where=")[1]!.split("&")[0]!);
    expect(where).toBe(
      "Date >= DateTime(2026,7,5) AND Date <= DateTime(2026,7,15)",
    );
  });
});

describe("checkXeroRegister — the decision", () => {
  const DRAFT = {
    ...EXPENSE_SEARCH,
    excludeIds: new Set<string>(),
    draftEntity: "bill" as const,
    draftVendorId: "c-1",
    draftVendorNames: ["Staples", "STAPLES #114"],
  };

  it("clears one same-entity, same-vendor candidate", async () => {
    reply({ invoices: [BILL] });
    const { verdict } = await checkXeroRegister(CTX, DRAFT);
    expect(verdict.kind).toBe("clear");
  });

  it("says none when the books are empty", async () => {
    reply({});
    const { verdict } = await checkXeroRegister(CTX, DRAFT);
    expect(verdict.kind).toBe("none");
  });

  it("asks when two candidates match", async () => {
    reply({ invoices: [BILL, { ...BILL, InvoiceID: "inv-2" }] });
    const { verdict } = await checkXeroRegister(CTX, DRAFT);
    expect(verdict.kind).toBe("confirm");
  });

  it("asks when the candidate names a different supplier", async () => {
    reply({
      invoices: [{ ...BILL, Contact: { ContactID: "c-9", Name: "Bell Canada" } }],
    });
    const { verdict } = await checkXeroRegister(CTX, DRAFT);
    expect(verdict.kind).toBe("confirm");
  });

  it("still clears a bank-feed line with no supplier at all", async () => {
    // Bank descriptors rarely carry a contact, which is exactly why matching
    // doesn't REQUIRE the supplier to agree.
    reply({ invoices: [{ ...BILL, Contact: {} }] });
    const { verdict } = await checkXeroRegister(CTX, DRAFT);
    expect(verdict.kind).toBe("clear");
  });

  it("drops Vylan's own posts BEFORE classifying, not after", async () => {
    // The draft being re-posted must not be offered as a match for itself, and
    // its presence must not turn one real candidate into "more than one".
    reply({ invoices: [BILL, { ...BILL, InvoiceID: "ours" }] });
    const { verdict, candidates } = await checkXeroRegister(CTX, {
      ...DRAFT,
      excludeIds: new Set(["ours"]),
    });
    expect(candidates.map((c) => c.qboId)).toEqual(["inv-1"]);
    expect(verdict.kind).toBe("clear");
  });

  it("finds nothing to match once every candidate was posted by Vylan", async () => {
    reply({ invoices: [BILL] });
    const { verdict } = await checkXeroRegister(CTX, {
      ...DRAFT,
      excludeIds: new Set(["inv-1"]),
    });
    expect(verdict.kind).toBe("none");
  });

  it("asks rather than clearing when a register read failed", async () => {
    reply({ invoices: [BILL], failBank: true });
    const { verdict, readFailed } = await checkXeroRegister(CTX, DRAFT);
    expect(verdict.kind).toBe("confirm");
    expect(readFailed).toBe(true);
  });
});
