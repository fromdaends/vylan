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

describe("expectedYearFromTitle", () => {
  it("reads a single tax year from the title", () => {
    expect(expectedYearFromTitle("Smith — T1 2024")).toBe(2024);
  });
  it("returns null with no year or an ambiguous range", () => {
    expect(expectedYearFromTitle("Smith T1")).toBeNull();
    expect(expectedYearFromTitle("Fiscal 2023-2024")).toBeNull();
  });
});
