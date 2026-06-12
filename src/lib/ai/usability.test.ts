import { describe, it, expect } from "vitest";
import {
  USABILITY_CONFIDENCE_THRESHOLD,
  USABLE_BY_DEFAULT,
  isUsabilityIssue,
  shouldActOnUsability,
  wrongRecipientVerdict,
} from "./usability";

describe("shouldActOnUsability — auto-rejection threshold", () => {
  it("is false when the document is marked usable, regardless of confidence", () => {
    expect(
      shouldActOnUsability({
        ...USABLE_BY_DEFAULT,
        usable: true,
        confidence: 0.99,
      }),
    ).toBe(false);
  });

  it("is false just below the threshold (0.79)", () => {
    expect(
      shouldActOnUsability({
        usable: false,
        confidence: 0.79,
        primary_issue: "text_unreadable",
        all_issues: ["text_unreadable"],
        issue_summary_fr: "",
        issue_summary_en: "",
      }),
    ).toBe(false);
  });

  it("is true exactly at the threshold (0.80)", () => {
    expect(
      shouldActOnUsability({
        usable: false,
        confidence: USABILITY_CONFIDENCE_THRESHOLD,
        primary_issue: "text_unreadable",
        all_issues: ["text_unreadable"],
        issue_summary_fr: "",
        issue_summary_en: "",
      }),
    ).toBe(true);
  });

  it("is true well above the threshold (0.95)", () => {
    expect(
      shouldActOnUsability({
        usable: false,
        confidence: 0.95,
        primary_issue: "partial_capture",
        all_issues: ["partial_capture"],
        issue_summary_fr: "",
        issue_summary_en: "",
      }),
    ).toBe(true);
  });

  it("is false for the safe-default verdict (confidence 0)", () => {
    expect(shouldActOnUsability(USABLE_BY_DEFAULT)).toBe(false);
  });
});

describe("isUsabilityIssue", () => {
  it("accepts every documented issue", () => {
    for (const issue of [
      "text_unreadable",
      "key_fields_obscured",
      "partial_capture",
      "glare_or_shadow",
      "wrong_document_type",
      "corrupt_or_blank",
      "wrong_orientation",
      "password_protected",
      "missing_pages",
      "screenshot_of_screen",
      "other",
    ]) {
      expect(isUsabilityIssue(issue)).toBe(true);
    }
  });

  it("rejects unknown issue strings", () => {
    expect(isUsabilityIssue("low_resolution")).toBe(false);
    expect(isUsabilityIssue("blurry")).toBe(false);
    expect(isUsabilityIssue("")).toBe(false);
    expect(isUsabilityIssue(undefined)).toBe(false);
    expect(isUsabilityIssue(null)).toBe(false);
    expect(isUsabilityIssue(42)).toBe(false);
  });
});

describe("wrongRecipientVerdict — wrong-person hard reject", () => {
  it("is always actionable, even when the name read was only moderately confident", () => {
    // Founder rule: any stranger name → re-send. The matcher's own 0.5 floor is
    // the "reasonably sure" bar; above it we floor to the act threshold so the
    // router always bounces it, regardless of the legibility score.
    const v = wrongRecipientVerdict(
      USABLE_BY_DEFAULT,
      "Tyler Jette",
      "Jane Smith",
      0.6,
    );
    expect(v.usable).toBe(false);
    expect(shouldActOnUsability(v)).toBe(true);
    expect(v.confidence).toBeGreaterThanOrEqual(USABILITY_CONFIDENCE_THRESHOLD);
  });

  it("keeps the strongest confidence among base, match, and threshold", () => {
    const v = wrongRecipientVerdict(
      { ...USABLE_BY_DEFAULT, confidence: 0.97 },
      "Tyler Jette",
      "Jane Smith",
      0.6,
    );
    expect(v.confidence).toBe(0.97);
  });

  it("tags wrong_document_type without duplicating an existing one", () => {
    const v = wrongRecipientVerdict(
      { ...USABLE_BY_DEFAULT, all_issues: ["wrong_document_type"] },
      "Tyler Jette",
      "Jane Smith",
      0.9,
    );
    expect(v.primary_issue).toBe("wrong_document_type");
    expect(v.all_issues).toEqual(["wrong_document_type"]);
  });

  it("names both the client and the detected person in the bilingual reason", () => {
    const v = wrongRecipientVerdict(
      USABLE_BY_DEFAULT,
      "Tyler Jette",
      "Jane Smith",
      0.9,
    );
    expect(v.issue_summary_en).toContain("Jane Smith");
    expect(v.issue_summary_en).toContain("Tyler Jette");
    expect(v.issue_summary_fr).toContain("Jane Smith");
    expect(v.issue_summary_fr).toContain("Tyler Jette");
  });
});
