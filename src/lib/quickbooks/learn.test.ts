import { describe, it, expect } from "vitest";
import { learnedWritesFromResolve } from "./learn";
import { buildTransactionSuggestion } from "./suggest";
import type { ResolvedEntry } from "./suggest";
import type { QbNamed, QbAccount, QuickbooksLists } from "./read";
import type { TransactionExtraction } from "@/lib/ai/transaction-extract";

const vendors: QbNamed[] = [
  { id: "v1", name: "The Home Depot Inc.", active: true },
];
const customers: QbNamed[] = [
  { id: "c1", name: "Acme Manufacturing Inc.", active: true },
];
const accounts: QbAccount[] = [
  { id: "a1", name: "Supplies", accountType: "Expense", active: true },
  { id: "a2", name: "Fuel", accountType: "Expense", active: true },
  { id: "a4", name: "Sales", accountType: "Income", active: true },
];
const taxCodes: QbNamed[] = [{ id: "t2", name: "GST/QST QC", active: true }];
const lists: QuickbooksLists = { accounts, vendors, customers, taxCodes };

function extraction(
  over: Partial<TransactionExtraction> = {},
): TransactionExtraction {
  return {
    direction: "expense",
    vendor_name: "Home Depot",
    customer_name: null,
    document_date: "2024-03-14",
    document_number: null,
    currency: "CAD",
    subtotal: 100,
    total: 114.98,
    taxes: [
      { type: "GST", amount: 5, rate: 5 },
      { type: "QST", amount: 9.98, rate: 9.975 },
    ],
    line_items: [],
    paid: null,
    payment_method: null,
    confidence: 0.9,
    notes: null,
    ...over,
  };
}

const expenseSuggestion = buildTransactionSuggestion(extraction(), lists);
const incomeSuggestion = buildTransactionSuggestion(
  extraction({ direction: "income", vendor_name: null, customer_name: "Acme" }),
  lists,
);
const splitSuggestion = buildTransactionSuggestion(
  extraction({
    subtotal: 100,
    line_items: [
      { description: "Printer paper", amount: 60 },
      { description: "Diesel", amount: 40 },
    ],
  }),
  lists,
);

describe("learnedWritesFromResolve", () => {
  it("learns a vendor pick keyed by the normalized document name", () => {
    const patch: Partial<ResolvedEntry> = {
      party: { id: "v1", name: "The Home Depot Inc." },
    };
    expect(learnedWritesFromResolve(patch, expenseSuggestion)).toEqual([
      {
        signalType: "vendor",
        sourceKey: "home depot",
        sourceSample: "Home Depot",
        target: { id: "v1", name: "The Home Depot Inc." },
      },
    ]);
  });

  it("learns a customer pick for an income draft", () => {
    const patch: Partial<ResolvedEntry> = {
      party: { id: "c1", name: "Acme Manufacturing Inc." },
    };
    const writes = learnedWritesFromResolve(patch, incomeSuggestion);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ signalType: "customer", target: { id: "c1" } });
  });

  it("learns an expense account keyed by the vendor name", () => {
    const patch: Partial<ResolvedEntry> = {
      account: { id: "a1", name: "Supplies" },
    };
    expect(learnedWritesFromResolve(patch, expenseSuggestion)).toEqual([
      {
        signalType: "expense_account",
        sourceKey: "home depot",
        sourceSample: "Home Depot",
        target: { id: "a1", name: "Supplies" },
      },
    ]);
  });

  it("does NOT learn an expense account on an income draft", () => {
    const patch: Partial<ResolvedEntry> = {
      account: { id: "a1", name: "Supplies" },
    };
    expect(learnedWritesFromResolve(patch, incomeSuggestion)).toEqual([]);
  });

  it("learns a tax code keyed by the canonical tax set", () => {
    const patch: Partial<ResolvedEntry> = {
      taxCode: { id: "t2", name: "GST/QST QC" },
    };
    expect(learnedWritesFromResolve(patch, expenseSuggestion)).toEqual([
      {
        signalType: "tax",
        sourceKey: "GST+QST",
        sourceSample: "GST+QST",
        target: { id: "t2", name: "GST/QST QC" },
      },
    ]);
  });

  it("learns per-line accounts keyed by each line description, skipping nulls", () => {
    const patch: Partial<ResolvedEntry> = {
      lineAccounts: {
        "0": { id: "a1", name: "Supplies" },
        "1": null,
      },
    };
    expect(learnedWritesFromResolve(patch, splitSuggestion)).toEqual([
      {
        signalType: "line_account",
        sourceKey: "printer paper",
        sourceSample: "Printer paper",
        target: { id: "a1", name: "Supplies" },
      },
    ]);
  });

  it("ignores a line index that isn't in the suggestion", () => {
    const patch: Partial<ResolvedEntry> = {
      lineAccounts: { "9": { id: "a2", name: "Fuel" } },
    };
    expect(learnedWritesFromResolve(patch, splitSuggestion)).toEqual([]);
  });

  it("teaches nothing when a field is cleared (null)", () => {
    expect(
      learnedWritesFromResolve({ party: null }, expenseSuggestion),
    ).toEqual([]);
    expect(
      learnedWritesFromResolve({ taxCode: null }, expenseSuggestion),
    ).toEqual([]);
  });

  it("does not learn from fields absent in the patch", () => {
    // A paymentAccount pick alone carries no learnable signal (v1 scope).
    expect(
      learnedWritesFromResolve(
        { paymentAccount: { id: "a1", name: "Supplies" } },
        expenseSuggestion,
      ),
    ).toEqual([]);
  });

  it("skips party/account learning when the suggestion lacks a source name", () => {
    const noSource = { ...expenseSuggestion, partySource: null };
    expect(
      learnedWritesFromResolve(
        { party: { id: "v1", name: "The Home Depot Inc." } },
        noSource,
      ),
    ).toEqual([]);
    expect(
      learnedWritesFromResolve({ account: { id: "a1", name: "Supplies" } }, noSource),
    ).toEqual([]);
  });
});
