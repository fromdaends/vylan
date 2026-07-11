import { describe, expect, it } from "vitest";
import {
  amountCandidates,
  compactFile,
  compactFileDetails,
  fileMatches,
  isFlagged,
  normalizeText,
  searchFiles,
  type ChatFileRow,
} from "./search";

function file(overrides: Partial<ChatFileRow> = {}): ChatFileRow {
  return {
    id: "f-1",
    request_item_id: "i-1",
    display_name: "Receipt - Staples - 2025.pdf",
    original_filename: "IMG_1234.pdf",
    ai_classification: "receipt",
    ai_confidence: 0.95,
    review_status: "pending",
    rejection_reason: null,
    reviewed_by: null,
    is_duplicate: false,
    uploaded_at: "2026-07-01T10:00:00Z",
    ai_extracted_fields: {
      extracted_year: 2025,
      extracted_amount_or_total: 240.0,
      document_date: "2025-11-03",
      issuer_name: "Staples",
      party_name: "Jean Tremblay",
      account_or_period: null,
      form_identifier: null,
      key_identifiers: ["Bureau en Gros"],
      amounts: [
        { label: "Sous-total", value: 208.75 },
        { label: "Total", value: 240.0 },
      ],
      issue_if_any: null,
      transaction: {
        direction: "expense",
        vendor_name: "Staples / Bureau en Gros",
        customer_name: null,
        document_date: "2025-11-03",
        currency: "CAD",
        subtotal: 208.75,
        total: 240.0,
        taxes: [{ type: "TPS", amount: 10.44 }],
        line_items: [
          { description: "Chaise de bureau", amount: 179.99 },
          { description: "Papier", amount: 28.76 },
        ],
        paid: true,
        payment_method: "card",
      },
    },
    ai_usability: {
      usable: true,
      primary_issue: null,
      all_issues: [],
      issue_summary_en: null,
      issue_summary_fr: null,
    },
    ...overrides,
  };
}

describe("normalizeText", () => {
  it("lowers case and strips accents", () => {
    expect(normalizeText("Hydro-Québec ÉTÉ")).toBe("hydro-quebec ete");
  });
});

describe("vendor matching", () => {
  it("matches accent- and case-insensitively across extracted names", () => {
    expect(fileMatches(file(), { vendor: "staples" })).toBe(true);
    expect(fileMatches(file(), { vendor: "BUREAU EN GROS" })).toBe(true);
    expect(fileMatches(file(), { vendor: "Tremblay" })).toBe(true);
    expect(fileMatches(file(), { vendor: "Costco" })).toBe(false);
  });
});

describe("amount matching", () => {
  it("collects every dollar figure on the document", () => {
    expect(amountCandidates(file())).toEqual(
      expect.arrayContaining([240.0, 208.75, 179.99, 28.76]),
    );
  });

  it("matches the total to the cent", () => {
    expect(fileMatches(file(), { amount: 240 })).toBe(true);
    expect(fileMatches(file(), { amount: 240.005 })).toBe(true);
    expect(fileMatches(file(), { amount: 240.5 })).toBe(false);
  });

  it("matches a line item, not just the total", () => {
    expect(fileMatches(file(), { amount: 179.99 })).toBe(true);
  });

  it("respects an explicit tolerance", () => {
    expect(fileMatches(file(), { amount: 238, amount_tolerance: 5 })).toBe(true);
    expect(fileMatches(file(), { amount: 230, amount_tolerance: 5 })).toBe(false);
  });

  it("combines vendor + amount (the Staples $240 question)", () => {
    expect(fileMatches(file(), { vendor: "Staples", amount: 240 })).toBe(true);
    expect(fileMatches(file(), { vendor: "Costco", amount: 240 })).toBe(false);
  });
});

describe("flags, status, year, type", () => {
  it("flagged: unusable verdict", () => {
    const f = file({ ai_usability: { usable: false, primary_issue: "glare_or_shadow" } });
    expect(isFlagged(f)).toBe(true);
    expect(fileMatches(f, { flagged_only: true })).toBe(true);
    expect(fileMatches(file(), { flagged_only: true })).toBe(false);
  });

  it("flagged: rejected, duplicate, or noted concern", () => {
    expect(isFlagged(file({ review_status: "rejected" }))).toBe(true);
    expect(isFlagged(file({ is_duplicate: true }))).toBe(true);
    expect(
      isFlagged(
        file({
          ai_extracted_fields: {
            ...file().ai_extracted_fields,
            issue_if_any: "Amount partially obscured",
          },
        }),
      ),
    ).toBe(true);
  });

  it("filters by review status", () => {
    expect(fileMatches(file(), { status: "pending" })).toBe(true);
    expect(fileMatches(file(), { status: "approved" })).toBe(false);
  });

  it("filters by year from extracted_year or dates", () => {
    expect(fileMatches(file(), { year: 2025 })).toBe(true);
    expect(fileMatches(file(), { year: 2024 })).toBe(false);
    const noYear = file({
      ai_extracted_fields: {
        ...file().ai_extracted_fields,
        extracted_year: null,
      },
    });
    // Falls back to the document dates (2025-11-03).
    expect(fileMatches(noYear, { year: 2025 })).toBe(true);
  });

  it("matches doc_type loosely on separators", () => {
    const stmt = file({ ai_classification: "bank_statement" });
    expect(fileMatches(stmt, { doc_type: "bank statement" })).toBe(true);
    expect(fileMatches(stmt, { doc_type: "bank-statement" })).toBe(true);
    expect(fileMatches(stmt, { doc_type: "receipt" })).toBe(false);
  });
});

describe("searchFiles", () => {
  it("returns newest first with a total and a cap", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      file({
        id: `f-${i}`,
        uploaded_at: `2026-07-${String(1 + (i % 9)).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    const out = searchFiles(rows, {}, 10);
    expect(out.total).toBe(25);
    expect(out.returned).toBe(10);
    expect(out.results).toHaveLength(10);
    const dates = out.results.map((r) => r.uploaded_at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("empty criteria returns everything", () => {
    const out = searchFiles([file()], {});
    expect(out.total).toBe(1);
  });
});

describe("compaction", () => {
  it("compactFile keeps the identifying essentials", () => {
    const c = compactFile(file());
    expect(c).toMatchObject({
      file_id: "f-1",
      name: "Receipt - Staples - 2025.pdf",
      doc_type: "receipt",
      review_status: "pending",
      issuer: "Staples",
      year: 2025,
      headline_amount: 240.0,
      flagged: false,
    });
  });

  it("compactFileDetails distinguishes system vs accountant rejections", () => {
    const system = compactFileDetails(
      file({ review_status: "rejected", reviewed_by: null }),
    );
    expect(system.rejected_by).toBe("system");
    const human = compactFileDetails(
      file({ review_status: "rejected", reviewed_by: "u-1" }),
    );
    expect(human.rejected_by).toBe("accountant");
    const pending = compactFileDetails(file());
    expect(pending.rejected_by).toBeNull();
  });

  it("compactFileDetails carries the transaction breakdown", () => {
    const d = compactFileDetails(file());
    expect(d.transaction).toMatchObject({
      vendor: "Staples / Bureau en Gros",
      total: 240.0,
      paid: true,
    });
    expect(d.transaction?.line_items).toHaveLength(2);
  });

  it("handles rows with no AI data at all", () => {
    const bare = file({
      ai_extracted_fields: null,
      ai_usability: null,
      ai_classification: null,
      display_name: null,
      original_filename: null,
    });
    expect(() => compactFileDetails(bare)).not.toThrow();
    expect(fileMatches(bare, { vendor: "Staples" })).toBe(false);
    expect(fileMatches(bare, { amount: 240 })).toBe(false);
    expect(searchFiles([bare], {}).total).toBe(1);
  });
});
