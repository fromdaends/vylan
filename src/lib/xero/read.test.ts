import { describe, it, expect } from "vitest";
import {
  normalizeXeroAccountType,
  toXeroAccountRow,
  toXeroContactRow,
  toXeroTaxRateRow,
  toXeroItemRow,
  xeroRowsToLists,
} from "./read";

// The adapter is load-bearing AND silent-failing: a wrong account-type mapping
// or a wrong contact split doesn't error — it just yields empty candidate pools
// in the matcher. These lock the mapping down.

describe("normalizeXeroAccountType — feeds the shared matcher's type predicates", () => {
  it("maps BANK by BankAccountType so isPaymentAccountType matches exactly", () => {
    expect(normalizeXeroAccountType("BANK", "BANK", "ASSET")).toBe("Bank");
    expect(normalizeXeroAccountType("BANK", "CREDITCARD", "LIABILITY")).toBe(
      "Credit Card",
    );
    // PayPal / unknown bank sub-type still reads as a money account (paid-from).
    expect(normalizeXeroAccountType("BANK", "PAYPAL", "ASSET")).toBe("Bank");
  });
  it("maps expense-family types to an 'Expense'/'Cost of Goods' string", () => {
    expect(normalizeXeroAccountType("EXPENSE", null, "EXPENSE")).toBe("Expense");
    expect(normalizeXeroAccountType("OVERHEADS", null, "EXPENSE")).toBe("Expense");
    expect(normalizeXeroAccountType("DIRECTCOSTS", null, "EXPENSE")).toBe(
      "Cost of Goods Sold",
    );
  });
  it("maps revenue-family types to an 'Income' string", () => {
    expect(normalizeXeroAccountType("REVENUE", null, "REVENUE")).toBe("Income");
    expect(normalizeXeroAccountType("SALES", null, "REVENUE")).toBe("Income");
  });
  it("falls back to Class when Type is unhelpful", () => {
    expect(normalizeXeroAccountType("CURRLIAB", null, "EXPENSE")).toBe("Expense");
    expect(normalizeXeroAccountType("OTHERINCOME", null, "REVENUE")).toBe("Income");
  });
  it("passes non-expense/income/bank through raw (won't match a predicate)", () => {
    expect(normalizeXeroAccountType("FIXED", null, "ASSET")).toBe("FIXED");
    expect(normalizeXeroAccountType(null, null, null)).toBeNull();
  });
});

describe("row mappers", () => {
  it("account: ARCHIVED status → inactive, code trimmed", () => {
    expect(
      toXeroAccountRow({
        AccountID: "A1",
        Code: " 200 ",
        Name: "Sales",
        Type: "REVENUE",
        Class: "REVENUE",
        Status: "ARCHIVED",
      }),
    ).toEqual({ xeroId: "A1", code: "200", name: "Sales", accountType: "Income", active: false });
  });
  it("tax rate keys on TaxType; DELETED → inactive", () => {
    expect(toXeroTaxRateRow({ TaxType: "CAN007", Name: "ON HST on Purchases", Status: "ACTIVE" })).toEqual(
      { xeroId: "CAN007", name: "ON HST on Purchases", active: true },
    );
    expect(toXeroTaxRateRow({ TaxType: "OLD", Name: "x", Status: "DELETED" }).active).toBe(false);
  });
  it("item bridges income account by code", () => {
    expect(
      toXeroItemRow({ ItemID: "I1", Code: "CONSULT", Name: "Consulting", SalesDetails: { AccountCode: "200" } }),
    ).toEqual({ xeroId: "I1", code: "CONSULT", name: "Consulting", incomeAccountCode: "200", active: true });
  });
});

describe("xeroRowsToLists — unified Contacts split", () => {
  const contacts = [
    toXeroContactRow({ ContactID: "c-sup", Name: "Hydro Supplier", ContactStatus: "ACTIVE", IsSupplier: true }),
    toXeroContactRow({ ContactID: "c-cus", Name: "Acme Client", ContactStatus: "ACTIVE", IsCustomer: true }),
    toXeroContactRow({ ContactID: "c-both", Name: "Both Co", ContactStatus: "ACTIVE", IsSupplier: true, IsCustomer: true }),
    toXeroContactRow({ ContactID: "c-new", Name: "Fresh Contact", ContactStatus: "ACTIVE" }),
  ];

  it("puts suppliers in vendors, customers in customers, both/unflagged in BOTH", () => {
    const lists = xeroRowsToLists({ accounts: null, contacts, taxRates: null, items: null });
    const vendorIds = (lists.vendors ?? []).map((v) => v.id);
    const customerIds = (lists.customers ?? []).map((c) => c.id);
    // vendor list: pure supplier + both + un-flagged (NOT the pure customer)
    expect(vendorIds.sort()).toEqual(["c-both", "c-new", "c-sup"]);
    // customer list: pure customer + both + un-flagged (NOT the pure supplier)
    expect(customerIds.sort()).toEqual(["c-both", "c-cus", "c-new"]);
  });

  it("maps accounts straight through; null lists stay null", () => {
    const lists = xeroRowsToLists({
      accounts: [toXeroAccountRow({ AccountID: "A1", Name: "Bank", Type: "BANK", BankAccountType: "BANK" })],
      contacts: null,
      taxRates: null,
      items: null,
    });
    expect(lists.accounts).toEqual([{ id: "A1", name: "Bank", accountType: "Bank", active: true }]);
    expect(lists.vendors).toBeNull();
    expect(lists.customers).toBeNull();
    expect(lists.items).toBeNull();
  });

  it("resolves an item's income account CODE to the account's AccountID (GUID)", () => {
    const lists = xeroRowsToLists({
      accounts: [
        toXeroAccountRow({
          AccountID: "acc-guid",
          Code: "200",
          Name: "Consulting Revenue",
          Type: "REVENUE",
        }),
      ],
      contacts: null,
      taxRates: null,
      items: [
        toXeroItemRow({ ItemID: "i1", Code: "CONSULT", Name: "Consulting", SalesDetails: { AccountCode: "200" } }),
      ],
    });
    // The bridge must land in the AccountID space the matcher compares against.
    expect(lists.items).toEqual([
      { id: "i1", name: "Consulting", itemType: null, incomeAccountId: "acc-guid", active: true },
    ]);
  });

  it("leaves incomeAccountId null when the item's code maps to no loaded account", () => {
    const lists = xeroRowsToLists({
      accounts: [toXeroAccountRow({ AccountID: "acc-guid", Code: "200", Name: "Revenue", Type: "REVENUE" })],
      contacts: null,
      taxRates: null,
      items: [
        toXeroItemRow({ ItemID: "i1", Code: "X", Name: "X", SalesDetails: { AccountCode: "999" } }),
      ],
    });
    expect(lists.items?.[0]?.incomeAccountId).toBeNull();
  });
});
