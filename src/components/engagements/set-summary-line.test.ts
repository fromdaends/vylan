import { describe, it, expect } from "vitest";
import { shouldShowSetLine, splitConclusionPoints } from "./set-summary-line";
import type { SetAssessment } from "@/lib/ai/set-assessment";

// shouldShowSetLine only reads `.outcome`, so a minimal stub stands in for the
// full assessment.
function assess(outcome: SetAssessment["outcome"]): SetAssessment {
  return { outcome } as SetAssessment;
}

describe("shouldShowSetLine", () => {
  it("is false with no assessment", () => {
    expect(shouldShowSetLine(null, 4)).toBe(false);
    expect(shouldShowSetLine(undefined, 4)).toBe(false);
  });

  it("shows on any real multi-file set", () => {
    expect(shouldShowSetLine(assess("complete"), 2)).toBe(true);
    expect(shouldShowSetLine(assess("not_a_set"), 5)).toBe(true);
  });

  it("hides a lone, fine single file (the per-file row already covers it)", () => {
    expect(shouldShowSetLine(assess("complete"), 1)).toBe(false);
    expect(shouldShowSetLine(assess("not_a_set"), 1)).toBe(false);
  });

  it("shows a single file that still needs attention", () => {
    expect(shouldShowSetLine(assess("incomplete"), 1)).toBe(true);
    expect(shouldShowSetLine(assess("unplaceable"), 1)).toBe(true);
  });

  // The headline bookkeeping case: a year of statements inside ONE PDF, every
  // page present (outcome "complete", fileCount 1), but a month missing between
  // two of them. Without this the finding is computed and never shown.
  it("shows a single COMPLETE file when a cross-statement finding exists", () => {
    const withFinding = {
      outcome: "complete",
      chain_findings: [
        { kind: "gap", from: "2026-02-26", to: "2026-03-27", text_en: "x", text_fr: "x" },
      ],
    } as unknown as SetAssessment;
    expect(shouldShowSetLine(withFinding, 1)).toBe(true);
  });

  it("still hides a lone clean file when there are no findings", () => {
    const noFindings = {
      outcome: "complete",
      chain_findings: [],
      chain_coverage: [{ statements: 3 }],
    } as unknown as SetAssessment;
    expect(shouldShowSetLine(noFindings, 1)).toBe(false);
  });
});

describe("splitConclusionPoints", () => {
  it("splits the model's semicolon-welded verdict into separate points", () => {
    expect(
      splitConclusionPoints(
        "The complete four-page Scotiabank statement for April 27 to May 26, 2026 is present; File 2 is a duplicate copy of pages 1 to 3.",
      ),
    ).toEqual([
      "The complete four-page Scotiabank statement for April 27 to May 26, 2026 is present",
      "File 2 is a duplicate copy of pages 1 to 3.",
    ]);
  });

  it("splits on sentence boundaries too", () => {
    expect(
      splitConclusionPoints("Pages 1 to 4 are present. Page 3 is blurry."),
    ).toEqual(["Pages 1 to 4 are present.", "Page 3 is blurry."]);
  });

  it("keeps a single-fact conclusion as one point", () => {
    expect(splitConclusionPoints("All four pages are present.")).toEqual([
      "All four pages are present.",
    ]);
  });

  it("does NOT split inside decimals, dates or abbreviations", () => {
    // A bare /\./ split would shatter "1,234.56", "no. 4" and "Jan. 2026".
    expect(
      splitConclusionPoints("The balance of 1,234.56 on p. 2 matches."),
    ).toEqual(["The balance of 1,234.56 on p. 2 matches."]);
  });

  it("drops empty fragments and trailing separators", () => {
    expect(splitConclusionPoints("One thing;; Another thing;")).toEqual([
      "One thing",
      "Another thing",
    ]);
    expect(splitConclusionPoints("   ")).toEqual([]);
  });
});
