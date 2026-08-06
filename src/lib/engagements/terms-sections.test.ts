import { describe, it, expect } from "vitest";
import {
  readTermsSections,
  hasTerms,
  termsToPlainText,
} from "./terms-sections";

describe("readTermsSections — every old proposal still reads", () => {
  it("upgrades a legacy string into ONE untitled section", () => {
    // Contracts clients have already agreed to carry a plain string. They must
    // render byte-identically — and must not gain a heading they never had.
    expect(readTermsSections("Our standard terms apply.")).toEqual([
      { heading: "", body: "Our standard terms apply." },
    ]);
  });

  it("an empty legacy string is no terms at all", () => {
    expect(readTermsSections("")).toEqual([]);
    expect(readTermsSections("   ")).toEqual([]);
  });

  it("survives null, undefined and nonsense", () => {
    for (const raw of [null, undefined, 42, {}, true]) {
      expect(() => readTermsSections(raw)).not.toThrow();
      expect(readTermsSections(raw)).toEqual([]);
    }
  });
});

describe("readTermsSections — the section list", () => {
  it("keeps headings and bodies, trimmed", () => {
    expect(
      readTermsSections([
        { heading: "  Scope  ", body: "  What we do.  " },
        { heading: "Fees", body: "What it costs." },
      ]),
    ).toEqual([
      { heading: "Scope", body: "What we do." },
      { heading: "Fees", body: "What it costs." },
    ]);
  });

  it("drops a heading with nothing under it", () => {
    // A title promising terms that are not there is worse on a contract than
    // no section at all.
    expect(
      readTermsSections([
        { heading: "Termination", body: "   " },
        { heading: "Fees", body: "Monthly." },
      ]),
    ).toEqual([{ heading: "Fees", body: "Monthly." }]);
  });

  it("a body with no heading is kept — that is the legacy shape", () => {
    expect(readTermsSections([{ body: "Just the terms." }])).toEqual([
      { heading: "", body: "Just the terms." },
    ]);
  });

  it("accepts bare strings inside the list", () => {
    expect(readTermsSections(["First.", "Second."])).toEqual([
      { heading: "", body: "First." },
      { heading: "", body: "Second." },
    ]);
  });

  it("skips entries that are not sections at all", () => {
    expect(readTermsSections([null, 7, { heading: "A", body: "B" }])).toEqual([
      { heading: "A", body: "B" },
    ]);
  });

  it("caps the list and the heading length", () => {
    const many = readTermsSections(
      Array.from({ length: 50 }, (_, i) => ({ heading: `H${i}`, body: "x" })),
    );
    expect(many).toHaveLength(30);
    const long = readTermsSections([{ heading: "H".repeat(500), body: "x" }]);
    expect(long[0].heading).toHaveLength(200);
  });
});

describe("hasTerms", () => {
  it("is false for nothing and for whitespace", () => {
    expect(hasTerms([])).toBe(false);
    expect(hasTerms([{ heading: "Scope", body: "   " }])).toBe(false);
  });

  it("is true once one section says something", () => {
    expect(hasTerms([{ heading: "", body: "Terms." }])).toBe(true);
  });
});

describe("termsToPlainText", () => {
  it("keeps the structure for surfaces that take one string", () => {
    expect(
      termsToPlainText([
        { heading: "Scope", body: "What we do." },
        { heading: "", body: "Everything else." },
      ]),
    ).toBe("Scope\nWhat we do.\n\nEverything else.");
  });

  it("a single untitled section round-trips to exactly its body", () => {
    // The legacy value in, the legacy value out — nothing added.
    expect(termsToPlainText(readTermsSections("Our terms."))).toBe("Our terms.");
  });
});
