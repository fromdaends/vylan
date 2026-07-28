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

  // The key carries DIRECTION: a sale and a purchase with the same taxes need
  // different rates ("GST on Income" vs "GST on Purchases"), and one shared key
  // meant whichever was confirmed last silently re-coded the other.
  it("learns a tax code keyed by the canonical tax set AND direction", () => {
    const patch: Partial<ResolvedEntry> = {
      taxCode: { id: "t2", name: "GST/QST QC" },
    };
    expect(learnedWritesFromResolve(patch, expenseSuggestion)).toEqual([
      {
        signalType: "tax",
        sourceKey: "GST+QST|expense",
        sourceSample: "GST+QST",
        target: { id: "t2", name: "GST/QST QC" },
      },
    ]);
  });

  it("keys a sale's tax separately from a purchase's", () => {
    const patch: Partial<ResolvedEntry> = {
      taxCode: { id: "t2", name: "GST/QST QC" },
    };
    const income = learnedWritesFromResolve(patch, incomeSuggestion);
    expect(income.find((w) => w.signalType === "tax")?.sourceKey).toBe(
      "GST+QST|income",
    );
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

  // Regression guard: the split UI seeds every line from the AI's own match and
  // posts the FULL map when one line is edited, so an untouched line arrives
  // non-null carrying a guess. Learning it would harden a guess into a
  // remembered "correction" — the exact thing this module promises not to do.
  // Descriptions here deliberately match account names so the matcher DOES
  // produce a per-line suggestion (the splitSuggestion fixture above matches
  // nothing, which is why it never exercised this path).
  const matchedSplit = buildTransactionSuggestion(
    extraction({
      subtotal: 100,
      line_items: [
        { description: "Supplies", amount: 60 },
        { description: "Fuel", amount: 40 },
      ],
    }),
    lists,
  );

  it("does NOT learn a line left on the AI's own suggested account", () => {
    const aiPick = matchedSplit.lines![0].account.match!;
    expect(aiPick.id).toBe("a1"); // fixture sanity: the matcher really matched
    expect(
      learnedWritesFromResolve(
        { lineAccounts: { "0": { id: aiPick.id, name: aiPick.name } } },
        matchedSplit,
      ),
    ).toEqual([]);
  });

  it("learns only the edited line when the full map is posted", () => {
    const untouched = matchedSplit.lines![1].account.match!;
    const writes = learnedWritesFromResolve(
      {
        lineAccounts: {
          // Line 0 genuinely changed away from the AI's "a1" pick...
          "0": { id: "a2", name: "Fuel" },
          // ...line 1 is the AI's own guess riding along untouched.
          "1": { id: untouched.id, name: untouched.name },
        },
      },
      matchedSplit,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      signalType: "line_account",
      sourceKey: "supplies",
      sourceSample: "Supplies",
      target: { id: "a2", name: "Fuel" },
    });
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

  // The bank account IS learnable now, and keyed by direction alone: it is a
  // property of the client's books rather than of the document, and it is the
  // same account almost every time. Without this the accountant re-picks it on
  // every paid receipt forever.
  it("learns the bank account keyed by direction", () => {
    expect(
      learnedWritesFromResolve(
        { paymentAccount: { id: "bank1", name: "Chequing" } },
        expenseSuggestion,
      ),
    ).toEqual([
      {
        signalType: "payment_account",
        sourceKey: "expense",
        sourceSample: "expense",
        target: { id: "bank1", name: "Chequing" },
      },
    ]);
  });

  it("keeps a sale's deposit account separate from an expense's paid-from", () => {
    const w = learnedWritesFromResolve(
      { paymentAccount: { id: "bank1", name: "Chequing" } },
      incomeSuggestion,
    );
    expect(w[0]?.sourceKey).toBe("income");
  });

  it("teaches nothing when the bank account is cleared", () => {
    expect(
      learnedWritesFromResolve({ paymentAccount: null }, expenseSuggestion),
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
