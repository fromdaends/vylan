import { describe, it, expect } from "vitest";
import { parseClassification } from "./classify";
import { USABLE_BY_DEFAULT } from "./usability";

describe("parseClassification", () => {
  it("returns a complete result for valid input", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.92,
      extracted_year: 2024,
      extracted_amount_or_total: 52140,
      looks_correct: true,
      issue_if_any: null,
      usable: true,
      usability_confidence: 0.96,
      primary_issue: null,
      all_issues: [],
      issue_summary_fr: "",
      issue_summary_en: "",
    });
    expect(out).toEqual({
      document_type: "t4",
      confidence: 0.92,
      extracted_year: 2024,
      extracted_amount_or_total: 52140,
      looks_correct: true,
      issue_if_any: null,
      usability: {
        usable: true,
        confidence: 0.96,
        primary_issue: null,
        all_issues: [],
        issue_summary_fr: "",
        issue_summary_en: "",
      },
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

  it("defaults usability to the safe state when usable / usability_confidence are absent", () => {
    // Older tool responses won't have the new fields. Fail-safe so a
    // legacy / hesitant AI never auto-rejects a clean file.
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: 2024,
      extracted_amount_or_total: 1000,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(out?.usability).toEqual(USABLE_BY_DEFAULT);
  });

  it("captures an unusable verdict with all the bilingual reason fields", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: 0.91,
      primary_issue: "partial_capture",
      all_issues: ["partial_capture", "glare_or_shadow"],
      issue_summary_fr: "Le côté droit du document est coupé.",
      issue_summary_en: "The right side of the document is cut off.",
    });
    expect(out?.usability).toEqual({
      usable: false,
      confidence: 0.91,
      primary_issue: "partial_capture",
      all_issues: ["partial_capture", "glare_or_shadow"],
      issue_summary_fr: "Le côté droit du document est coupé.",
      issue_summary_en: "The right side of the document is cut off.",
    });
  });

  it("drops unknown issue values from all_issues + nulls an invalid primary_issue", () => {
    // The model can occasionally hallucinate an enum value. Filter
    // unknowns rather than rejecting the whole assessment.
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: 0.85,
      primary_issue: "low_resolution",
      all_issues: ["low_resolution", "text_unreadable", "smudged"],
      issue_summary_fr: "Image floue.",
      issue_summary_en: "Image is blurry.",
    });
    expect(out?.usability.primary_issue).toBeNull();
    expect(out?.usability.all_issues).toEqual(["text_unreadable"]);
  });

  it("clamps usability_confidence into [0,1]", () => {
    const hi = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: 1.5,
      primary_issue: "text_unreadable",
      all_issues: ["text_unreadable"],
      issue_summary_fr: "x",
      issue_summary_en: "y",
    });
    expect(hi?.usability.confidence).toBe(1);

    const lo = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: -0.2,
      primary_issue: "text_unreadable",
      all_issues: ["text_unreadable"],
      issue_summary_fr: "x",
      issue_summary_en: "y",
    });
    expect(lo?.usability.confidence).toBe(0);
  });
});
