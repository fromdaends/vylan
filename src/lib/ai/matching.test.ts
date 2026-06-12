import { describe, it, expect } from "vitest";
import {
  matchDocument,
  expectedYearFromTitle,
  type MatchClassification,
} from "./matching";

const base: MatchClassification = {
  document_type: "t4",
  confidence: 0.9,
  extracted_year: 2024,
  party_name: "Jane Doe",
  fields_confidence: 0.9,
};

describe("matchDocument — type", () => {
  it("flags a confident type mismatch", () => {
    const flags = matchDocument({
      expectedDocType: "bank_statement",
      expectedYear: null,
      clientName: null,
      classification: { ...base, document_type: "credit_card_statement" },
    });
    expect(flags).toEqual([
      {
        kind: "type_mismatch",
        confidence: 0.9,
        expected: "bank_statement",
        actual: "credit_card_statement",
      },
    ]);
  });

  it("stays quiet when the detected type is the expected one", () => {
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: null,
        clientName: null,
        classification: base,
      }),
    ).toEqual([]);
  });

  it("does not flag 'unknown' as a type mismatch", () => {
    const flags = matchDocument({
      expectedDocType: "t4",
      expectedYear: null,
      clientName: null,
      classification: { ...base, document_type: "unknown" },
    });
    expect(flags.find((f) => f.kind === "type_mismatch")).toBeUndefined();
  });

  it("suppresses a type mismatch when the AI was unsure (<0.5)", () => {
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: null,
        clientName: null,
        classification: { ...base, document_type: "t4a", confidence: 0.4 },
      }),
    ).toEqual([]);
  });

  it("never flags a type mismatch when the item expects 'other' (freeform item)", () => {
    // "other" is the default doc type for custom/freeform checklist items, i.e.
    // no specific type was requested — any recognised document is acceptable.
    expect(
      matchDocument({
        expectedDocType: "other",
        expectedYear: null,
        clientName: null,
        classification: { ...base, document_type: "bank_statement" },
      }),
    ).toEqual([]);
  });
});

describe("matchDocument — year", () => {
  it("flags a wrong year when one is expected", () => {
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: 2024,
        clientName: null,
        classification: { ...base, extracted_year: 2023 },
      }),
    ).toEqual([
      { kind: "year_mismatch", confidence: 0.9, expected: "2024", actual: "2023" },
    ]);
  });

  it("stays quiet with no expected year, a matching year, or low confidence", () => {
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: null,
        clientName: null,
        classification: { ...base, extracted_year: 2023 },
      }),
    ).toEqual([]);
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: 2024,
        clientName: null,
        classification: base,
      }),
    ).toEqual([]);
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: 2024,
        clientName: null,
        classification: { ...base, extracted_year: 2023, fields_confidence: 0.3 },
      }),
    ).toEqual([]);
  });
});

describe("matchDocument — identity (lenient on family files)", () => {
  it("flags a total stranger", () => {
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: null,
        clientName: "John Smith",
        classification: { ...base, party_name: "Marie Tremblay" },
      }),
    ).toEqual([
      {
        kind: "identity_mismatch",
        confidence: 0.9,
        expected: "John Smith",
        actual: "Marie Tremblay",
      },
    ]);
  });

  it("stays quiet on a shared surname (spouse / joint file)", () => {
    const flags = matchDocument({
      expectedDocType: "t4",
      expectedYear: null,
      clientName: "John Smith",
      classification: { ...base, party_name: "Mary Smith" },
    });
    expect(flags.find((f) => f.kind === "identity_mismatch")).toBeUndefined();
  });

  it("ignores accents and case when comparing names", () => {
    const flags = matchDocument({
      expectedDocType: "t4",
      expectedYear: null,
      clientName: "Éric Côté",
      classification: { ...base, party_name: "ERIC COTE" },
    });
    expect(flags.find((f) => f.kind === "identity_mismatch")).toBeUndefined();
  });

  it("stays quiet when the name was unreadable or low-confidence", () => {
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: null,
        clientName: "John Smith",
        classification: { ...base, party_name: null },
      }).find((f) => f.kind === "identity_mismatch"),
    ).toBeUndefined();
    expect(
      matchDocument({
        expectedDocType: "t4",
        expectedYear: null,
        clientName: "John Smith",
        classification: {
          ...base,
          party_name: "Marie Tremblay",
          fields_confidence: 0.3,
        },
      }),
    ).toEqual([]);
  });
});

describe("matchDocument — identity (AI belongs_to_client judgment)", () => {
  it("flags when the model says the document belongs to someone else", () => {
    const flags = matchDocument({
      expectedDocType: "t4",
      expectedYear: null,
      clientName: "Tyler Jette",
      classification: {
        ...base,
        party_name: "Jane Smith",
        belongs_to_client: false,
        belongs_confidence: 0.92,
      },
    });
    expect(flags).toEqual([
      {
        kind: "identity_mismatch",
        confidence: 0.92,
        expected: "Tyler Jette",
        actual: "Jane Smith",
      },
    ]);
  });

  it("stays quiet when the model says it BELONGS — even with NO shared name (the business-doc fix)", () => {
    // "Smith Plumbing Inc." vs client "Tyler Jette": no shared name token, but
    // the model reasoned it's the client's own business. The AI judgment
    // OVERRIDES the blunt name-token heuristic, so no false flag / false bounce.
    const flags = matchDocument({
      expectedDocType: "t2125",
      expectedYear: null,
      clientName: "Tyler Jette",
      classification: {
        ...base,
        document_type: "t2125",
        party_name: "Smith Plumbing Inc.",
        belongs_to_client: true,
        belongs_confidence: 0.9,
      },
    });
    expect(flags.find((f) => f.kind === "identity_mismatch")).toBeUndefined();
  });

  it("stays quiet when the model is unsure it belongs (< 0.5)", () => {
    const flags = matchDocument({
      expectedDocType: "t4",
      expectedYear: null,
      clientName: "Tyler Jette",
      classification: {
        ...base,
        party_name: "Jane Smith",
        belongs_to_client: false,
        belongs_confidence: 0.4,
      },
    });
    expect(flags.find((f) => f.kind === "identity_mismatch")).toBeUndefined();
  });

  it("falls back to the name-token heuristic only when belongs is absent (legacy data)", () => {
    const legacy = matchDocument({
      expectedDocType: "t4",
      expectedYear: null,
      clientName: "Tyler Jette",
      classification: { ...base, party_name: "Jane Smith" }, // no belongs signal
    });
    expect(legacy.find((f) => f.kind === "identity_mismatch")).toBeDefined();
  });
});

describe("expectedYearFromTitle", () => {
  it("reads a single tax year from the title", () => {
    expect(expectedYearFromTitle("Smith — T1 2024")).toBe(2024);
  });
  it("returns null with no year or an ambiguous range", () => {
    expect(expectedYearFromTitle("Smith T1")).toBeNull();
    expect(expectedYearFromTitle("Fiscal 2023-2024")).toBeNull();
  });
});
