import { describe, it, expect } from "vitest";
import { shouldShowSetLine } from "./set-summary-line";
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
});
