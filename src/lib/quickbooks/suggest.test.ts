import { describe, it, expect } from "vitest";
import {
  nameTokens,
  nameScore,
  matchTaxCode,
  suggestAccount,
  buildTransactionSuggestion,
  MATCH_THRESHOLD,
} from "./suggest";
import type { QbNamed, QbAccount, QuickbooksLists } from "./read";
import type { TransactionExtraction } from "@/lib/ai/transaction-extract";

const vendors: QbNamed[] = [
  { id: "v1", name: "The Home Depot Inc.", active: true },
  { id: "v2", name: "Bell Canada", active: true },
  { id: "v3", name: "Hydro-Québec", active: true },
  { id: "v4", name: "Old Supplier Ltd", active: false },
];
const customers: QbNamed[] = [
  { id: "c1", name: "Acme Manufacturing Inc.", active: true },
  { id: "c2", name: "Beta Corp", active: true },
];
const accounts: QbAccount[] = [
  { id: "a1", name: "Supplies", accountType: "Expense", active: true },
  { id: "a2", name: "Telephone", accountType: "Expense", active: true },
  { id: "a3", name: "Cost of Goods Sold", accountType: "Cost of Goods Sold", active: true },
  { id: "a4", name: "Sales", accountType: "Income", active: true },
  { id: "a5", name: "Consulting Revenue", accountType: "Other Income", active: true },
  { id: "a6", name: "Chequing", accountType: "Bank", active: true },
];
const taxCodes: QbNamed[] = [
  { id: "t1", name: "GST", active: true },
  { id: "t2", name: "GST/QST QC - 9.975", active: true },
  { id: "t3", name: "HST ON", active: true },
  { id: "t4", name: "Exempt", active: true },
];
const lists: QuickbooksLists = { accounts, vendors, customers, taxCodes };

function extraction(
  over: Partial<TransactionExtraction> = {},
): TransactionExtraction {
  return {
    direction: "expense",
    vendor_name: "Home Depot",
    customer_name: null,
    document_date: "2024-03-14",
    currency: "CAD",
    subtotal: 100,
    total: 114.98,
    taxes: [
      { type: "GST", amount: 5, rate: 5 },
      { type: "QST", amount: 9.98, rate: 9.975 },
    ],
    confidence: 0.9,
    notes: null,
    ...over,
  };
}

describe("nameTokens", () => {
  it("strips business suffixes and leading noise", () => {
    expect(nameTokens("The Home Depot Inc.")).toEqual(["home", "depot"]);
    expect(nameTokens("Old Supplier Ltd")).toEqual(["old", "supplier"]);
  });
  it("strips accents and punctuation", () => {
    expect(nameTokens("Hydro-Québec")).toEqual(["hydro", "quebec"]);
  });
  it("keeps a lone noise word rather than emptying", () => {
    expect(nameTokens("Le")).toEqual(["le"]);
  });
});

describe("nameScore", () => {
  it("scores exact (post-normalization) as 1", () => {
    expect(nameScore("Home Depot", "The Home Depot Inc.")).toBe(1);
  });
  it("scores full containment of the shorter name highly", () => {
    expect(nameScore("Bell", "Bell Canada")).toBeGreaterThanOrEqual(
      MATCH_THRESHOLD,
    );
  });
  it("scores unrelated names 0", () => {
    expect(nameScore("Costco", "Walmart")).toBe(0);
  });
  it("returns 0 for empty inputs", () => {
    expect(nameScore("", "Bell")).toBe(0);
    expect(nameScore("Bell", "   ")).toBe(0);
  });
});

describe("matchTaxCode", () => {
  it("prefers the combined GST/QST code when both taxes are present", () => {
    const m = matchTaxCode(extraction().taxes, taxCodes);
    expect(m.match).toEqual({ id: "t2", name: "GST/QST QC - 9.975" });
    expect(m.confidence).toBe(1);
  });
  it("matches a single GST and treats GST-only as confident", () => {
    const m = matchTaxCode([{ type: "GST", amount: 5, rate: 5 }], taxCodes);
    // Both "GST" and "GST/QST..." contain GST; the single-token doc wants only
    // GST, so any code covering it is full coverage. Top by active + order.
    expect(m.match).not.toBeNull();
    expect(m.confidence).toBe(1);
    expect(m.candidates.length).toBeGreaterThan(0);
  });
  it("maps French TPS/TVQ to GST/QST", () => {
    const m = matchTaxCode(
      [
        { type: "TPS", amount: 5, rate: 5 },
        { type: "TVQ", amount: 9.98, rate: 9.975 },
      ],
      taxCodes,
    );
    expect(m.match).toEqual({ id: "t2", name: "GST/QST QC - 9.975" });
  });
  it("returns no match when the document has no tax", () => {
    expect(matchTaxCode([], taxCodes).match).toBeNull();
  });
  it("returns no match when tax codes aren't loaded", () => {
    expect(matchTaxCode(extraction().taxes, null).match).toBeNull();
  });
  it("lists a partial code as a candidate but not a confident match for multi-tax", () => {
    // Only a GST-only code available, but the doc has GST + QST -> partial.
    const m = matchTaxCode(extraction().taxes, [
      { id: "t1", name: "GST", active: true },
    ]);
    expect(m.match).toBeNull();
    expect(m.candidates).toEqual([{ id: "t1", name: "GST", score: 0.5 }]);
  });
});

describe("suggestAccount", () => {
  it("narrows to expense accounts for an expense", () => {
    const m = suggestAccount("expense", "random vendor", accounts);
    // No name match, so no confident pick, but candidates are expense-kind only.
    expect(m.match).toBeNull();
    const ids = m.candidates.map((c) => c.id);
    expect(ids).toContain("a1");
    expect(ids).toContain("a3"); // cost of goods sold counts
    expect(ids).not.toContain("a4"); // income excluded
    expect(ids).not.toContain("a6"); // bank excluded
  });
  it("narrows to income accounts for income", () => {
    const m = suggestAccount("income", "whatever", accounts);
    const ids = m.candidates.map((c) => c.id);
    expect(ids).toContain("a4");
    expect(ids).toContain("a5");
    expect(ids).not.toContain("a1");
  });
  it("makes a confident pick when the party name resembles an account", () => {
    const m = suggestAccount("expense", "Telephone", accounts);
    expect(m.match).toEqual({ id: "a2", name: "Telephone" });
  });
  it("returns kind-filtered candidates with score 0 when there's no party name", () => {
    const m = suggestAccount("expense", null, accounts);
    expect(m.match).toBeNull();
    expect(m.candidates.every((c) => c.score === 0)).toBe(true);
    expect(m.candidates.length).toBeGreaterThan(0);
  });
  it("returns nothing when accounts aren't loaded", () => {
    expect(suggestAccount("expense", "x", null).candidates).toEqual([]);
  });
});

describe("buildTransactionSuggestion", () => {
  it("maps a clean Quebec expense receipt end to end", () => {
    const s = buildTransactionSuggestion(extraction(), lists);
    expect(s.direction).toBe("expense");
    expect(s.partyKind).toBe("vendor");
    expect(s.party.match).toEqual({ id: "v1", name: "The Home Depot Inc." });
    expect(s.taxCode.match).toEqual({ id: "t2", name: "GST/QST QC - 9.975" });
    expect(s.amount).toBe(114.98);
    expect(s.subtotal).toBe(100);
    expect(s.taxTotal).toBe(14.98);
    expect(s.date).toBe("2024-03-14");
    // Account needs the accountant, so a note prompts for it.
    expect(s.account.match).toBeNull();
    expect(s.notes.some((n) => n.toLowerCase().includes("expense account"))).toBe(
      true,
    );
    expect(s.overallConfidence).toBeGreaterThan(0.5);
  });

  it("maps an income invoice against the customer list", () => {
    const s = buildTransactionSuggestion(
      extraction({
        direction: "income",
        vendor_name: null,
        customer_name: "Acme Manufacturing",
      }),
      lists,
    );
    expect(s.partyKind).toBe("customer");
    expect(s.party.match).toEqual({ id: "c1", name: "Acme Manufacturing Inc." });
    expect(s.notes.some((n) => n.toLowerCase().includes("income account"))).toBe(
      true,
    );
  });

  it("notes when no vendor match is found", () => {
    const s = buildTransactionSuggestion(
      extraction({ vendor_name: "Totally Unknown Store" }),
      lists,
    );
    expect(s.party.match).toBeNull();
    expect(s.notes.some((n) => n.includes("No matching vendor"))).toBe(true);
  });

  it("falls back to a vendor and notes ambiguity when direction is unknown", () => {
    const s = buildTransactionSuggestion(
      extraction({ direction: "unknown", vendor_name: "Bell" }),
      lists,
    );
    expect(s.partyKind).toBe("vendor");
    expect(s.party.match).toEqual({ id: "v2", name: "Bell Canada" });
    expect(s.notes.some((n) => n.includes("expense or income"))).toBe(true);
  });

  it("flags a foreign currency", () => {
    const s = buildTransactionSuggestion(
      extraction({ currency: "USD" }),
      lists,
    );
    expect(s.notes.some((n) => n.includes("USD"))).toBe(true);
  });

  it("flags amounts that don't reconcile", () => {
    const s = buildTransactionSuggestion(
      extraction({ subtotal: 100, total: 200 }),
      lists,
    );
    expect(s.notes.some((n) => n.includes("doesn't match the total"))).toBe(true);
  });

  it("degrades gracefully when cached lists are unavailable", () => {
    const s = buildTransactionSuggestion(extraction(), {
      accounts: null,
      vendors: null,
      customers: null,
      taxCodes: null,
    });
    expect(s.party.match).toBeNull();
    expect(s.taxCode.match).toBeNull();
    expect(s.account.match).toBeNull();
    expect(s.notes.some((n) => n.includes("vendor list isn't loaded"))).toBe(
      true,
    );
    expect(s.notes.some((n) => n.includes("chart of accounts isn't loaded"))).toBe(
      true,
    );
  });

  it("handles a document with no readable party name", () => {
    const s = buildTransactionSuggestion(
      extraction({ vendor_name: null }),
      lists,
    );
    expect(s.partyKind).toBe("vendor");
    expect(s.party.match).toBeNull();
    expect(s.notes.some((n) => n.includes("No vendor name was read"))).toBe(true);
  });
});
