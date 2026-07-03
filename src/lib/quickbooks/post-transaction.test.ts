import { describe, it, expect } from "vitest";
import {
  buildBillPayload,
  checkBillPostable,
  buildInvoicePayload,
  checkInvoicePostable,
  buildPurchasePayload,
  checkPurchasePostable,
  paymentTypeForAccount,
  deriveNetAmount,
  resolveTaxApplication,
  taxDiscrepancyNote,
} from "./post-transaction";
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
  it("posts the GROSS amount and no tax fields when no tax is applied", () => {
    const bill = buildBillPayload({
      vendorId: "v1",
      accountId: "a1",
      amount: 115,
      date: null,
      tax: null,
    });
    const line = (bill.Line as Array<Record<string, unknown>>)[0];
    expect(line.Amount).toBe(115);
    expect(
      (line.AccountBasedExpenseLineDetail as Record<string, unknown>)
        .TaxCodeRef,
    ).toBeUndefined();
    expect("GlobalTaxCalculation" in bill).toBe(false);
    expect("TxnTaxDetail" in bill).toBe(false);
  });
  it("posts the NET amount + TaxCodeRef + GlobalTaxCalculation for a non-US tax", () => {
    const bill = buildBillPayload({
      vendorId: "v1",
      accountId: "a1",
      amount: 115, // gross — must NOT be used when tax is applied
      date: null,
      tax: {
        taxCodeId: "TC5",
        netAmount: 100,
        globalTaxCalculation: "TaxExcluded",
      },
    });
    const line = (bill.Line as Array<Record<string, unknown>>)[0];
    expect(line.Amount).toBe(100);
    expect(
      (line.AccountBasedExpenseLineDetail as Record<string, unknown>)
        .TaxCodeRef,
    ).toEqual({ value: "TC5" });
    expect(bill.GlobalTaxCalculation).toBe("TaxExcluded");
    // Transaction-level tax code (mandatory AST intent) — else QBO errors 6000.
    expect(bill.TxnTaxDetail).toEqual({ TxnTaxCodeRef: { value: "TC5" } });
  });
  it("SPLITS across lines when lines[] is given (each its own account + shared tax code)", () => {
    const bill = buildBillPayload({
      vendorId: "v1",
      accountId: "a1", // single-line fallback — ignored when lines[] present
      amount: 229.95,
      date: null,
      tax: {
        taxCodeId: "TC5",
        netAmount: 200,
        globalTaxCalculation: "TaxExcluded",
      },
      lines: [
        { amount: 159, accountId: "a1" },
        { amount: 41, accountId: "a2" },
      ],
    });
    const lines = bill.Line as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.Amount).toBe(159);
    expect(
      (lines[0]!.AccountBasedExpenseLineDetail as Record<string, unknown>)
        .AccountRef,
    ).toEqual({ value: "a1" });
    expect(lines[1]!.Amount).toBe(41);
    expect(
      (lines[1]!.AccountBasedExpenseLineDetail as Record<string, unknown>)
        .AccountRef,
    ).toEqual({ value: "a2" });
    // Shared tax code on every line + the transaction-level AST fields.
    expect(
      (lines[0]!.AccountBasedExpenseLineDetail as Record<string, unknown>)
        .TaxCodeRef,
    ).toEqual({ value: "TC5" });
    expect(bill.TxnTaxDetail).toEqual({ TxnTaxCodeRef: { value: "TC5" } });
  });
  it("attaches the TaxCodeRef but OMITS GlobalTaxCalculation for a US tax (null)", () => {
    const bill = buildBillPayload({
      vendorId: "v1",
      accountId: "a1",
      amount: 108,
      date: null,
      tax: { taxCodeId: "TAX", netAmount: 100, globalTaxCalculation: null },
    });
    const line = (bill.Line as Array<Record<string, unknown>>)[0];
    expect(line.Amount).toBe(100);
    expect(
      (line.AccountBasedExpenseLineDetail as Record<string, unknown>)
        .TaxCodeRef,
    ).toEqual({ value: "TAX" });
    expect("GlobalTaxCalculation" in bill).toBe(false);
    // TxnTaxDetail is still sent (AST intent) even when GlobalTaxCalculation isn't.
    expect(bill.TxnTaxDetail).toEqual({ TxnTaxCodeRef: { value: "TAX" } });
  });
});

describe("deriveNetAmount", () => {
  it("prefers a positive subtotal", () => {
    expect(deriveNetAmount(100, 115, 15)).toBe(100);
  });
  it("derives total - tax when subtotal is missing", () => {
    expect(deriveNetAmount(null, 115, 15)).toBe(100);
  });
  it("rounds the derived net to cents", () => {
    expect(deriveNetAmount(null, 115.005, 15)).toBe(100.01);
  });
  it("returns null when neither yields a positive net", () => {
    expect(deriveNetAmount(null, null, 15)).toBeNull();
    expect(deriveNetAmount(0, null, null)).toBeNull();
    expect(deriveNetAmount(null, 15, 15)).toBeNull(); // total - tax = 0
    expect(deriveNetAmount(null, 10, 15)).toBeNull(); // negative
  });
});

describe("resolveTaxApplication", () => {
  const base = {
    enabled: true,
    country: "CA",
    taxCodeId: "TC5",
    subtotal: 100,
    total: 115,
    taxTotal: 15,
  };
  it("non-US: net + code + TaxExcluded", () => {
    expect(resolveTaxApplication(base)).toEqual({
      taxCodeId: "TC5",
      netAmount: 100,
      globalTaxCalculation: "TaxExcluded",
    });
  });
  it("US: net + code but no GlobalTaxCalculation (null)", () => {
    const r = resolveTaxApplication({ ...base, country: "US" });
    expect(r?.globalTaxCalculation).toBeNull();
    expect(r?.netAmount).toBe(100);
  });
  it("unknown country is treated as US (omits the field)", () => {
    expect(
      resolveTaxApplication({ ...base, country: null })?.globalTaxCalculation,
    ).toBeNull();
  });
  it("returns null (gross fallback) when the flag is off", () => {
    expect(resolveTaxApplication({ ...base, enabled: false })).toBeNull();
  });
  it("returns null when the document had no tax", () => {
    expect(resolveTaxApplication({ ...base, taxTotal: null })).toBeNull();
  });
  it("returns null when no tax code was approved", () => {
    expect(resolveTaxApplication({ ...base, taxCodeId: null })).toBeNull();
  });
  it("returns null when the net can't be determined", () => {
    expect(
      resolveTaxApplication({ ...base, subtotal: null, total: null }),
    ).toBeNull();
  });
});

describe("taxDiscrepancyNote", () => {
  const agree = {
    computedTax: 15,
    documentTax: 15,
    computedTotal: 115,
    documentTotal: 115,
  };
  it("returns null when total + tax both match within tolerance", () => {
    expect(taxDiscrepancyNote(agree)).toBeNull();
    expect(
      taxDiscrepancyNote({
        ...agree,
        documentTax: 15.01,
        documentTotal: 115.01,
      }),
    ).toBeNull();
  });
  it("flags a GROSS-TOTAL drift (catches a mis-read subtotal even if tax matches)", () => {
    // net mis-read low -> QBO total understated, but computed tax happens to match.
    const note = taxDiscrepancyNote({
      computedTax: 15,
      documentTax: 15,
      computedTotal: 103.5,
      documentTotal: 115,
    });
    expect(note).toContain("total");
    expect(note).toContain("103.50");
    expect(note).toContain("115.00");
  });
  it("flags a TAX drift when the total isn't available", () => {
    const note = taxDiscrepancyNote({
      computedTax: 14.5,
      documentTax: 15,
      computedTotal: null,
      documentTotal: 115,
    });
    expect(note).toContain("14.50");
    expect(note).toContain("15.00");
  });
  it("returns null when the relevant amounts are unknown", () => {
    expect(
      taxDiscrepancyNote({
        computedTax: null,
        documentTax: 15,
        computedTotal: null,
        documentTotal: 115,
      }),
    ).toBeNull();
  });
});

const lists = (over: Partial<QuickbooksLists> = {}): QuickbooksLists => ({
  accounts: [
    { id: "a1", name: "Supplies", active: true, accountType: "Expense" },
  ],
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
    expect(
      checkBillPostable({ ...ok, direction: "income", lists: lists() }),
    ).toContain("not_expense");
    expect(
      checkBillPostable({ ...ok, direction: "unknown", lists: lists() }),
    ).toContain("not_expense");
  });
  it("flags a missing vendor / account / amount", () => {
    expect(checkBillPostable({ ...ok, party: null, lists: lists() })).toContain(
      "missing_vendor",
    );
    expect(
      checkBillPostable({ ...ok, account: null, lists: lists() }),
    ).toContain("missing_account");
    expect(
      checkBillPostable({ ...ok, amount: null, lists: lists() }),
    ).toContain("missing_amount");
    expect(checkBillPostable({ ...ok, amount: 0, lists: lists() })).toContain(
      "missing_amount",
    );
  });
  it("flags a vendor archived in QuickBooks since approval", () => {
    const archived = lists({
      vendors: [{ id: "v1", name: "Home Depot", active: false }],
    });
    expect(checkBillPostable({ ...ok, lists: archived })).toContain(
      "vendor_inactive",
    );
  });
  it("flags a vendor that no longer exists in the lists", () => {
    const gone = lists({ vendors: [{ id: "other", name: "X", active: true }] });
    expect(checkBillPostable({ ...ok, lists: gone })).toContain(
      "vendor_inactive",
    );
  });
  it("flags an inactive account", () => {
    const archived = lists({
      accounts: [
        { id: "a1", name: "Supplies", active: false, accountType: "Expense" },
      ],
    });
    expect(checkBillPostable({ ...ok, lists: archived })).toContain(
      "account_inactive",
    );
  });
  it("skips active checks when the lists aren't available (live API is the backstop)", () => {
    expect(checkBillPostable({ ...ok, lists: null })).toEqual([]);
  });
});

describe("buildInvoicePayload", () => {
  it("builds a minimal valid Invoice with a single item line", () => {
    const inv = buildInvoicePayload({
      customerId: "c1",
      itemId: "i1",
      amount: 250,
      date: "2026-02-18",
      memo: "Posted from Vylan",
    });
    expect(inv).toEqual({
      CustomerRef: { value: "c1" },
      TxnDate: "2026-02-18",
      PrivateNote: "Posted from Vylan",
      Line: [
        {
          DetailType: "SalesItemLineDetail",
          Amount: 250,
          SalesItemLineDetail: { ItemRef: { value: "i1" } },
        },
      ],
    });
  });
  it("rounds the amount and omits TxnDate/PrivateNote when absent", () => {
    const inv = buildInvoicePayload({
      customerId: "c1",
      itemId: "i1",
      amount: 10.005,
      date: null,
    });
    expect((inv.Line as Array<{ Amount: number }>)[0].Amount).toBe(10.01);
    expect("TxnDate" in inv).toBe(false);
    expect("PrivateNote" in inv).toBe(false);
  });
  it("posts the NET amount + TaxCodeRef on the item line + GlobalTaxCalculation", () => {
    const inv = buildInvoicePayload({
      customerId: "c1",
      itemId: "i1",
      amount: 287.5, // gross — must NOT be used when tax is applied
      date: null,
      tax: {
        taxCodeId: "TC5",
        netAmount: 250,
        globalTaxCalculation: "TaxExcluded",
      },
    });
    const line = (inv.Line as Array<Record<string, unknown>>)[0];
    expect(line.Amount).toBe(250);
    expect(
      (line.SalesItemLineDetail as Record<string, unknown>).TaxCodeRef,
    ).toEqual({ value: "TC5" });
    expect(inv.GlobalTaxCalculation).toBe("TaxExcluded");
    // Transaction-level tax code (mandatory AST intent) — else QBO errors 6000.
    expect(inv.TxnTaxDetail).toEqual({ TxnTaxCodeRef: { value: "TC5" } });
  });
});

const incomeLists = (over: Partial<QuickbooksLists> = {}): QuickbooksLists => ({
  accounts: [],
  vendors: [],
  customers: [{ id: "c1", name: "A Client", active: true }],
  taxCodes: [],
  items: [
    {
      id: "i1",
      name: "Consulting",
      itemType: "Service",
      incomeAccountId: "x",
      active: true,
    },
  ],
  ...over,
});

describe("checkInvoicePostable", () => {
  const ok = {
    direction: "income",
    party: { id: "c1", name: "A Client" },
    item: { id: "i1", name: "Consulting" },
    amount: 250,
  };
  it("a complete active income draft is postable", () => {
    expect(checkInvoicePostable({ ...ok, lists: incomeLists() })).toEqual([]);
  });
  it("rejects a non-income direction", () => {
    expect(
      checkInvoicePostable({
        ...ok,
        direction: "expense",
        lists: incomeLists(),
      }),
    ).toContain("not_income");
  });
  it("flags a missing customer / item / amount", () => {
    expect(
      checkInvoicePostable({ ...ok, party: null, lists: incomeLists() }),
    ).toContain("missing_customer");
    expect(
      checkInvoicePostable({ ...ok, item: null, lists: incomeLists() }),
    ).toContain("missing_item");
    expect(
      checkInvoicePostable({ ...ok, amount: 0, lists: incomeLists() }),
    ).toContain("missing_amount");
  });
  it("flags an archived customer or item", () => {
    const archivedCustomer = incomeLists({
      customers: [{ id: "c1", name: "A Client", active: false }],
    });
    expect(checkInvoicePostable({ ...ok, lists: archivedCustomer })).toContain(
      "customer_inactive",
    );
    const archivedItem = incomeLists({
      items: [
        {
          id: "i1",
          name: "Consulting",
          itemType: "Service",
          incomeAccountId: "x",
          active: false,
        },
      ],
    });
    expect(checkInvoicePostable({ ...ok, lists: archivedItem })).toContain(
      "item_inactive",
    );
  });
  it("skips active checks when the lists aren't available", () => {
    expect(checkInvoicePostable({ ...ok, lists: null })).toEqual([]);
  });
});

const purchaseLists = (
  over: Partial<QuickbooksLists> = {},
): QuickbooksLists => ({
  accounts: [
    { id: "a1", name: "Supplies", active: true, accountType: "Expense" },
    { id: "cc1", name: "Visa", active: true, accountType: "Credit Card" },
    { id: "bank1", name: "Chequing", active: true, accountType: "Bank" },
  ],
  vendors: [{ id: "v1", name: "Home Depot", active: true }],
  customers: [],
  taxCodes: [],
  ...over,
});

describe("paymentTypeForAccount", () => {
  it("maps a Credit Card account to CreditCard, everything else to Cash", () => {
    expect(paymentTypeForAccount("Credit Card")).toBe("CreditCard");
    expect(paymentTypeForAccount("credit card")).toBe("CreditCard");
    expect(paymentTypeForAccount("Bank")).toBe("Cash");
    expect(paymentTypeForAccount(null)).toBe("Cash");
  });
});

describe("buildPurchasePayload", () => {
  it("posts a paid expense against the payment account with a vendor + PaymentType", () => {
    const p = buildPurchasePayload({
      vendorId: "v1",
      accountId: "a1",
      paymentAccountId: "cc1",
      paymentType: "CreditCard",
      amount: 113,
      date: "2026-06-18",
      memo: "Posted from Vylan",
    });
    expect(p).toEqual({
      PaymentType: "CreditCard",
      AccountRef: { value: "cc1" },
      EntityRef: { value: "v1", type: "Vendor" },
      TxnDate: "2026-06-18",
      PrivateNote: "Posted from Vylan",
      Line: [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Amount: 113,
          AccountBasedExpenseLineDetail: { AccountRef: { value: "a1" } },
        },
      ],
    });
  });
  it("posts NET + line tax code + TxnTaxDetail + GlobalTaxCalculation when tax applies", () => {
    const p = buildPurchasePayload({
      vendorId: "v1",
      accountId: "a1",
      paymentAccountId: "bank1",
      paymentType: "Cash",
      amount: 113, // gross — must NOT be used when tax is applied
      date: null,
      tax: {
        taxCodeId: "TC5",
        netAmount: 100,
        globalTaxCalculation: "TaxExcluded",
      },
    });
    const line = (p.Line as Array<Record<string, unknown>>)[0];
    expect(line.Amount).toBe(100);
    expect(
      (line.AccountBasedExpenseLineDetail as Record<string, unknown>)
        .TaxCodeRef,
    ).toEqual({ value: "TC5" });
    expect(p.TxnTaxDetail).toEqual({ TxnTaxCodeRef: { value: "TC5" } });
    expect(p.GlobalTaxCalculation).toBe("TaxExcluded");
    expect(p.AccountRef).toEqual({ value: "bank1" });
  });
});

describe("checkPurchasePostable", () => {
  const ok = {
    direction: "expense",
    party: { id: "v1", name: "Home Depot" },
    account: { id: "a1", name: "Supplies" },
    paymentAccount: { id: "cc1", name: "Visa" },
    amount: 113,
  };
  it("a complete active paid expense is postable", () => {
    expect(checkPurchasePostable({ ...ok, lists: purchaseLists() })).toEqual(
      [],
    );
  });
  it("rejects income and flags a missing paid-from account", () => {
    expect(
      checkPurchasePostable({
        ...ok,
        direction: "income",
        lists: purchaseLists(),
      }),
    ).toContain("not_expense");
    expect(
      checkPurchasePostable({
        ...ok,
        paymentAccount: null,
        lists: purchaseLists(),
      }),
    ).toContain("missing_payment_account");
  });
  it("flags an archived paid-from account", () => {
    const archived = purchaseLists({
      accounts: [
        { id: "a1", name: "Supplies", active: true, accountType: "Expense" },
        { id: "cc1", name: "Visa", active: false, accountType: "Credit Card" },
      ],
    });
    expect(checkPurchasePostable({ ...ok, lists: archived })).toContain(
      "payment_account_inactive",
    );
  });
  it("flags a paid-from account that isn't a bank/credit-card type", () => {
    // Resolve the paid-from account to an Expense-type account (a1) — invalid.
    expect(
      checkPurchasePostable({
        ...ok,
        paymentAccount: { id: "a1", name: "Supplies" },
        lists: purchaseLists(),
      }),
    ).toContain("payment_account_wrong_type");
  });
  it("skips active checks when the lists aren't available", () => {
    expect(checkPurchasePostable({ ...ok, lists: null })).toEqual([]);
  });
});
