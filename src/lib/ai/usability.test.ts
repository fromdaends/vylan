import { describe, it, expect } from "vitest";
import {
  USABILITY_CONFIDENCE_THRESHOLD,
  USABLE_BY_DEFAULT,
  isUsabilityIssue,
  shouldActOnUsability,
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

  // Authority change: missing pages is decided by the SET assessment, never by
  // the per-file router — so a lone photo of "page 1 of 4" must not auto-reject.
  it("does NOT act when the headline issue is missing_pages, even at high confidence", () => {
    expect(
      shouldActOnUsability({
        usable: false,
        confidence: 0.97,
        primary_issue: "missing_pages",
        all_issues: ["missing_pages"],
        issue_summary_fr: "",
        issue_summary_en: "",
      }),
    ).toBe(false);
  });

  it("still acts on a real quality issue (a missing-pages note as a SECONDARY issue does not shield it)", () => {
    expect(
      shouldActOnUsability({
        usable: false,
        confidence: 0.9,
        primary_issue: "glare_or_shadow",
        all_issues: ["glare_or_shadow", "missing_pages"],
        issue_summary_fr: "",
        issue_summary_en: "",
      }),
    ).toBe(true);
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
