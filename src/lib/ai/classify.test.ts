import { describe, it, expect } from "vitest";
import { parseClassification } from "./classify";

describe("parseClassification", () => {
  it("returns a complete result for valid input", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.92,
      extracted_year: 2024,
      extracted_amount_or_total: 52140,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(out).toEqual({
      document_type: "t4",
      confidence: 0.92,
      extracted_year: 2024,
      extracted_amount_or_total: 52140,
      looks_correct: true,
      issue_if_any: null,
    });
  });

  it("collapses unknown document_type to 'unknown'", () => {
    const out = parseClassification({
      document_type: "made_up_thing",
      confidence: 0.4,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: false,
      issue_if_any: "Could not identify",
    });
    expect(out?.document_type).toBe("unknown");
  });

  it("clamps confidence into [0,1]", () => {
    const lo = parseClassification({
      document_type: "t4",
      confidence: -0.3,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: false,
      issue_if_any: null,
    });
    expect(lo?.confidence).toBe(0);
    const hi = parseClassification({
      document_type: "t4",
      confidence: 2.5,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(hi?.confidence).toBe(1);
  });

  it("nulls out missing or wrong-typed numeric fields", () => {
    const out = parseClassification({
      document_type: "rl1",
      confidence: 0.7,
      extracted_year: "twenty-twenty-four",
      extracted_amount_or_total: "$52,140",
      looks_correct: true,
      issue_if_any: null,
    });
    expect(out?.extracted_year).toBeNull();
    expect(out?.extracted_amount_or_total).toBeNull();
  });

  it("trims and normalizes empty issue_if_any to null", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.95,
      extracted_year: 2024,
      extracted_amount_or_total: 50000,
      looks_correct: true,
      issue_if_any: "   ",
    });
    expect(out?.issue_if_any).toBeNull();
  });

  it("returns null for malformed input (missing required fields)", () => {
    expect(parseClassification({})).toBeNull();
    expect(
      parseClassification({ document_type: "t4" }),
    ).toBeNull();
  });
});
