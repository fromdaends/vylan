import { describe, expect, it } from "vitest";
import {
  docTypeCodesMatching,
  groupDocumentAxes,
  isClassificationPending,
} from "./documents";

describe("groupDocumentAxes", () => {
  const rows = (...pairs: [number | null, string | null][]) =>
    pairs.map(([browse_year, browse_category]) => ({
      browse_year,
      browse_category,
    }));

  it("counts documents per year and per category within a year", () => {
    const years = groupDocumentAxes(
      rows([2024, "federal"], [2024, "federal"], [2024, "quebec"]),
    );
    expect(years).toHaveLength(1);
    expect(years[0].year).toBe(2024);
    expect(years[0].count).toBe(3);
    expect(years[0].categories).toEqual([
      { category: "federal", count: 2 },
      { category: "quebec", count: 1 },
    ]);
  });

  it("puts the newest year first so the current job is what you land on", () => {
    const years = groupDocumentAxes(rows([2022, "federal"], [2024, "federal"], [2023, "federal"]));
    expect(years.map((y) => y.year)).toEqual([2024, 2023, 2022]);
  });

  it("sinks the undated pile to the bottom, not the top", () => {
    // A null year sorts numerically as 0 in a naive comparator, which would put
    // every unreadable document above this year's work.
    const years = groupDocumentAxes(rows([null, "federal"], [2024, "federal"], [2019, "federal"]));
    expect(years.map((y) => y.year)).toEqual([2024, 2019, null]);
  });

  it("sinks the uncategorised bucket to the bottom within a year", () => {
    const years = groupDocumentAxes(
      rows([2024, null], [2024, "quebec"], [2024, "bookkeeping"]),
    );
    expect(years[0].categories.map((c) => c.category)).toEqual([
      "bookkeeping",
      "quebec",
      null,
    ]);
  });

  it("handles a client whose documents are entirely unsorted", () => {
    const years = groupDocumentAxes(rows([null, null], [null, null]));
    expect(years).toEqual([
      { year: null, count: 2, categories: [{ category: null, count: 2 }] },
    ]);
  });

  it("returns nothing for a client with no documents", () => {
    expect(groupDocumentAxes([])).toEqual([]);
  });
});

describe("isClassificationPending — the greyed-out-Move guard", () => {
  const NOW = Date.parse("2026-07-30T12:00:00Z");
  const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
  const doc = (over: Partial<Parameters<typeof isClassificationPending>[0]> = {}) => ({
    source: "checklist" as const,
    aiDocType: null,
    manualDocType: null,
    createdAt: minutesAgo(1),
    ...over,
  });

  it("is pending for an unread upload that just arrived", () => {
    expect(isClassificationPending(doc(), NOW)).toBe(true);
  });

  it("stops being pending once the analysis window has passed", () => {
    // The bug this test exists for: a file the AI never ran on would otherwise
    // show "Analyzing…" forever AND keep its Move button disabled — permanently
    // unsortable, with no way for the user to tell why.
    expect(isClassificationPending(doc({ createdAt: minutesAgo(16) }), NOW)).toBe(false);
    expect(isClassificationPending(doc({ createdAt: minutesAgo(60 * 24 * 11) }), NOW)).toBe(false);
  });

  it("is not pending once the AI has answered", () => {
    expect(isClassificationPending(doc({ aiDocType: "t4" }), NOW)).toBe(false);
  });

  it("is not pending once a human has answered", () => {
    expect(isClassificationPending(doc({ manualDocType: "t4" }), NOW)).toBe(false);
  });

  it("is never pending for an imported document", () => {
    // Imports skip the model entirely, so a fresh one would otherwise look
    // in-flight for its first 15 minutes and refuse to be sorted.
    expect(isClassificationPending(doc({ source: "imported" }), NOW)).toBe(false);
  });

  it("is never pending for a deliverable", () => {
    expect(isClassificationPending(doc({ source: "final" }), NOW)).toBe(false);
  });

  it("fails safe on an unparseable date", () => {
    // Better to allow Move than to lock a row nobody can explain.
    expect(isClassificationPending(doc({ createdAt: "not a date" }), NOW)).toBe(false);
  });
});

describe("docTypeCodesMatching", () => {
  it("finds a type by its code", () => {
    expect(docTypeCodesMatching("t4")).toContain("t4");
  });

  it("finds a type by its English label", () => {
    // Searching the words an accountant actually types, not just codes.
    expect(docTypeCodesMatching("statement").length).toBeGreaterThan(0);
  });

  it("finds a type by its French label", () => {
    // The product is bilingual; a French firm searches in French.
    expect(docTypeCodesMatching("relevé").length).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(docTypeCodesMatching("T4")).toEqual(docTypeCodesMatching("t4"));
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(docTypeCodesMatching("")).toEqual([]);
    expect(docTypeCodesMatching("   ")).toEqual([]);
  });

  it("returns nothing for a term that matches no type", () => {
    expect(docTypeCodesMatching("zzzzznotatype")).toEqual([]);
  });
});
