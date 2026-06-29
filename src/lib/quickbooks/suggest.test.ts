import { describe, it, expect } from "vitest";
import {
  nameTokens,
  nameScore,
  taxTokensFrom,
  matchTaxCode,
  suggestAccount,
  suggestItem,
  buildTransactionSuggestion,
  MATCH_THRESHOLD,
} from "./suggest";
import type { QbNamed, QbAccount, QbItem, QuickbooksLists } from "./read";
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
  it("keeps single-character tokens (A&W, 7-Eleven)", () => {
    expect(nameTokens("A&W")).toEqual(["a", "w"]);
    expect(nameTokens("7-Eleven")).toEqual(["7", "eleven"]);
  });
  it("keeps a lone noise word rather than emptying", () => {
    expect(nameTokens("Le")).toEqual(["le"]);
  });
  it("keeps non-Latin scripts instead of dropping them", () => {
    expect(nameTokens("日本")).toEqual(["日本"]);
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
  it("matches names that reduce to single-char tokens", () => {
    expect(nameScore("A&W", "A&W Restaurants")).toBeGreaterThan(0);
  });
  it("matches identical non-Latin names exactly", () => {
    expect(nameScore("日本", "日本")).toBe(1);
    expect(nameScore("東京", "東京 Inc")).toBe(1);
  });
  it("scores unrelated names 0", () => {
    expect(nameScore("Costco", "Walmart")).toBe(0);
  });
  it("returns 0 for empty inputs", () => {
    expect(nameScore("", "Bell")).toBe(0);
    expect(nameScore("Bell", "   ")).toBe(0);
  });
});

describe("taxTokensFrom (word-boundary, FR aliases)", () => {
  it("resolves combined and French codes to canonical tokens", () => {
    expect([...taxTokensFrom("GST/QST QC - 9.975")].sort()).toEqual(["GST", "QST"]);
    expect([...taxTokensFrom("TPS/TVQ (5%/9.975%)")].sort()).toEqual(["GST", "QST"]);
    expect([...taxTokensFrom("HST ON")]).toEqual(["HST"]);
  });
  it("does NOT substring-match a tax token inside a real word", () => {
    expect(taxTokensFrom("Private services").size).toBe(0); // 'VAT' not matched
    expect(taxTokensFrom("Innovate Inc").size).toBe(0);
  });
});

describe("matchTaxCode", () => {
  it("matches the combined GST/QST code when both taxes are present", () => {
    const m = matchTaxCode(extraction().taxes, taxCodes);
    expect(m.match).toEqual({ id: "t2", name: "GST/QST QC - 9.975", active: true });
    expect(m.confidence).toBe(1);
  });
  it("matches the PLAIN GST code for a GST-only receipt (no over-match to combined)", () => {
    const m = matchTaxCode([{ type: "GST", amount: 5, rate: 5 }], taxCodes);
    expect(m.match).toEqual({ id: "t1", name: "GST", active: true });
  });
  it("maps French TPS/TVQ on the document to GST/QST codes", () => {
    const m = matchTaxCode(
      [
        { type: "TPS", amount: 5, rate: 5 },
        { type: "TVQ", amount: 9.98, rate: 9.975 },
      ],
      taxCodes,
    );
    expect(m.match).toEqual({ id: "t2", name: "GST/QST QC - 9.975", active: true });
  });
  it("matches a French-NAMED QBO tax code", () => {
    const m = matchTaxCode(extraction().taxes, [
      { id: "f1", name: "TPS/TVQ (5%/9.975%)", active: true },
    ]);
    expect(m.match).toEqual({ id: "f1", name: "TPS/TVQ (5%/9.975%)", active: true });
  });
  it("does not confidently match a 'VAT' line against a non-tax code name", () => {
    const m = matchTaxCode([{ type: "VAT", amount: 2, rate: null }], [
      { id: "x", name: "Private services", active: true },
    ]);
    expect(m.match).toBeNull();
    expect(m.candidates).toEqual([]);
  });
  it("ignores junk (non-tax) lines when scoring", () => {
    const m = matchTaxCode(
      [
        { type: "GST", amount: 5, rate: 5 },
        { type: "QST", amount: 9.98, rate: 9.975 },
        { type: "Enviro fee", amount: 1, rate: null },
      ],
      taxCodes,
    );
    expect(m.match).toEqual({ id: "t2", name: "GST/QST QC - 9.975", active: true });
  });
  it("returns no match when the document has no tax / no codes loaded", () => {
    expect(matchTaxCode([], taxCodes).match).toBeNull();
    expect(matchTaxCode(extraction().taxes, null).match).toBeNull();
  });
  it("lists a partial code as a candidate but not a confident match", () => {
    const m = matchTaxCode(extraction().taxes, [
      { id: "t1", name: "GST", active: true },
    ]);
    expect(m.match).toBeNull();
    expect(m.candidates).toEqual([
      { id: "t1", name: "GST", active: true, score: 0.5 },
    ]);
  });
});

describe("ambiguity guard", () => {
  it("returns no confident match when two parties tie on a single-token name", () => {
    const m = buildTransactionSuggestion(extraction({ vendor_name: "Bell" }), {
      ...lists,
      vendors: [
        { id: "b1", name: "Bell Canada", active: true },
        { id: "b2", name: "Bell Mobility", active: true },
      ],
    });
    expect(m.party.match).toBeNull();
    expect(m.party.candidates).toHaveLength(2);
    expect(m.notes.some((n) => n.includes("Couldn't confidently pick"))).toBe(
      true,
    );
  });
});

describe("suggestAccount", () => {
  it("narrows to expense accounts for an expense", () => {
    const m = suggestAccount("expense", "random vendor", accounts);
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
    expect(m.match).toEqual({ id: "a2", name: "Telephone", active: true });
  });
  it("returns active-sorted kind-filtered candidates when there's no party name", () => {
    const withInactive: QbAccount[] = [
      { id: "i1", name: "Archived Expense", accountType: "Expense", active: false },
      ...accounts,
    ];
    const m = suggestAccount("expense", null, withInactive);
    expect(m.match).toBeNull();
    expect(m.candidates.every((c) => c.score === 0)).toBe(true);
    // Active accounts must come before the archived one.
    expect(m.candidates[0]!.active).toBe(true);
  });
  it("returns nothing when accounts aren't loaded", () => {
    expect(suggestAccount("expense", "x", null).candidates).toEqual([]);
  });
});

describe("archived (inactive) entities", () => {
  it("still matches an archived account but flags it active:false + a note", () => {
    const s = buildTransactionSuggestion(extraction({ vendor_name: "Telephone" }), {
      ...lists,
      accounts: [
        { id: "z", name: "Telephone", accountType: "Expense", active: false },
      ],
    });
    expect(s.account.match).toEqual({ id: "z", name: "Telephone", active: false });
    expect(s.notes.some((n) => n.includes("archived"))).toBe(true);
  });
  it("flags an archived vendor match", () => {
    const s = buildTransactionSuggestion(
      extraction({ vendor_name: "Old Supplier" }),
      lists,
    );
    expect(s.party.match).toEqual({
      id: "v4",
      name: "Old Supplier Ltd",
      active: false,
    });
    expect(s.notes.some((n) => n.includes("archived"))).toBe(true);
  });
});

describe("buildTransactionSuggestion", () => {
  it("maps a clean Quebec expense receipt end to end", () => {
    const s = buildTransactionSuggestion(extraction(), lists);
    expect(s.direction).toBe("expense");
    expect(s.partyKind).toBe("vendor");
    expect(s.party.match).toEqual({
      id: "v1",
      name: "The Home Depot Inc.",
      active: true,
    });
    expect(s.taxCode.match).toEqual({
      id: "t2",
      name: "GST/QST QC - 9.975",
      active: true,
    });
    expect(s.amount).toBe(114.98);
    expect(s.subtotal).toBe(100);
    expect(s.taxTotal).toBe(14.98);
    expect(s.date).toBe("2024-03-14");
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
    expect(s.party.match).toEqual({
      id: "c1",
      name: "Acme Manufacturing Inc.",
      active: true,
    });
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
    expect(s.party.match).toEqual({ id: "v2", name: "Bell Canada", active: true });
    expect(s.notes.some((n) => n.includes("expense or income"))).toBe(true);
  });

  it("flags a foreign currency", () => {
    const s = buildTransactionSuggestion(extraction({ currency: "USD" }), lists);
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
    expect(s.notes.some((n) => n.includes("vendor list isn't loaded"))).toBe(true);
    expect(s.notes.some((n) => n.includes("chart of accounts isn't loaded"))).toBe(
      true,
    );
  });

  it("handles a document with no readable party name", () => {
    const s = buildTransactionSuggestion(extraction({ vendor_name: null }), lists);
    expect(s.partyKind).toBe("vendor");
    expect(s.party.match).toBeNull();
    expect(s.notes.some((n) => n.includes("No vendor name was read"))).toBe(true);
  });

  it("scores an unidentified doc no higher than a matched one (readiness counts the missing party)", () => {
    const matched = buildTransactionSuggestion(extraction(), lists);
    const unidentified = buildTransactionSuggestion(
      extraction({ direction: "unknown", vendor_name: null, customer_name: null }),
      lists,
    );
    expect(unidentified.overallConfidence).toBeLessThan(
      matched.overallConfidence,
    );
  });
});

describe("suggestItem (income)", () => {
  const items: QbItem[] = [
    { id: "i1", name: "Consulting", itemType: "Service", incomeAccountId: "a1", active: true },
    { id: "i2", name: "Design", itemType: "Service", incomeAccountId: "a2", active: true },
    { id: "i3", name: "Design Rush", itemType: "Service", incomeAccountId: "a2", active: true },
    { id: "i4", name: "Old Service", itemType: "Service", incomeAccountId: "a3", active: false },
    { id: "i5", name: "A Category", itemType: "Category", incomeAccountId: "a1", active: true },
  ];

  it("returns empty for expense / unknown directions", () => {
    expect(suggestItem("expense", "a1", items)).toEqual({
      match: null,
      confidence: 0,
      candidates: [],
    });
    expect(suggestItem("unknown", "a1", items).match).toBeNull();
  });

  it("confidently picks the single active item that maps to the income account", () => {
    const r = suggestItem("income", "a1", items);
    // i5 is a Category (excluded), so a1 has exactly one sellable item: i1.
    expect(r.match).toEqual({ id: "i1", name: "Consulting", active: true });
  });

  it("does not confidently pick when several items map to the account (candidates only)", () => {
    const r = suggestItem("income", "a2", items);
    expect(r.match).toBeNull();
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["i2", "i3"]);
  });

  it("falls back to a shortlist when no account matched", () => {
    const r = suggestItem("income", null, items);
    expect(r.match).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("returns empty when there are no items", () => {
    expect(suggestItem("income", "a1", null).candidates).toEqual([]);
    expect(suggestItem("income", "a1", []).candidates).toEqual([]);
  });
});
