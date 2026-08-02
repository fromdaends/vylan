import { describe, it, expect } from "vitest";
import { scoreDocName, tokenizeQuery } from "./file-tools";

// The regression that forced this: "do we have a 2025 T4 for Jean Tremblay"
// found nothing while T4_2025.pdf sat in his files — a sentence never
// phrase-matches a snake_cased file name. Tokens must reach it.
describe("tokenizeQuery", () => {
  it("keeps the words that could appear in a file name", () => {
    expect(tokenizeQuery("do we have a 2025 T4 for Jean Tremblay")).toEqual([
      "2025",
      "t4",
      "jean",
      "tremblay",
    ]);
  });

  it("drops stopwords in both languages and caps at four tokens", () => {
    expect(tokenizeQuery("les relevés de la banque pour un client 2024 mars")).toHaveLength(4);
    expect(tokenizeQuery("the of for do we have")).toEqual([]);
  });
});

describe("scoreDocName", () => {
  const tokens = tokenizeQuery("2025 T4 Tremblay");

  it("T4_2025.pdf outranks an unrelated 2025 file for a T4 query", () => {
    const t4 = scoreDocName("t4_2025.pdf", "2025 t4 tremblay", tokens, false);
    const other = scoreDocName("medical_receipts_2025.jpg", "2025 t4 tremblay", tokens, false);
    expect(t4).toBeGreaterThan(other);
  });

  it("a content match boosts a name that says nothing", () => {
    const silent = scoreDocName("document.png", "hydro", ["hydro"], true);
    const named = scoreDocName("unrelated.pdf", "hydro", ["hydro"], false);
    expect(silent).toBeGreaterThan(named);
  });
});
