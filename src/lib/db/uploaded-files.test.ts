import { describe, it, expect } from "vitest";
import { resolvePromotedDuplicateReview } from "./uploaded-files";
import type { UsabilityVerdict } from "@/lib/ai/usability";

function verdict(o: Partial<UsabilityVerdict>): UsabilityVerdict {
  return {
    usable: true,
    confidence: 0.99,
    primary_issue: null,
    all_issues: [],
    issue_summary_fr: "",
    issue_summary_en: "",
    ...o,
  };
}

describe("resolvePromotedDuplicateReview", () => {
  it("reopens a copy rejected ONLY for being a duplicate", () => {
    // Its original is gone, and the AI has no complaint about the file itself.
    expect(
      resolvePromotedDuplicateReview({
        review_status: "rejected",
        reviewed_by: null,
        ai_usability: verdict({ usable: true }),
      }).reopen,
    ).toBe(true);
  });

  // THE reported bug. A statement with a blacked-out balance was auto-rejected
  // on its own merits, then promoted when its original was deleted. The old
  // rule reopened it: the client portal went back to "In review" and stopped
  // asking for a clean copy, while the accountant still saw "please upload an
  // unaltered bank statement". Two surfaces, two different stories.
  it("does NOT reopen a copy the AI condemned on its own merits", () => {
    expect(
      resolvePromotedDuplicateReview({
        review_status: "rejected",
        reviewed_by: null,
        ai_usability: verdict({
          usable: false,
          confidence: 0.97,
          primary_issue: "key_fields_obscured",
        }),
      }).reopen,
    ).toBe(false);
  });

  it("reopens when the AI was unusable but NOT confident enough to have acted", () => {
    // Below the act threshold the rejection can't have come from usability, so
    // the duplicate was its only basis.
    expect(
      resolvePromotedDuplicateReview({
        review_status: "rejected",
        reviewed_by: null,
        ai_usability: verdict({ usable: false, confidence: 0.5 }),
      }).reopen,
    ).toBe(true);
  });

  it("never overrides an accountant's own rejection", () => {
    expect(
      resolvePromotedDuplicateReview({
        review_status: "rejected",
        reviewed_by: "user-1",
        ai_usability: verdict({ usable: true }),
      }).reopen,
    ).toBe(false);
  });

  it("leaves a copy that was never rejected alone", () => {
    for (const status of ["pending", "approved", null]) {
      expect(
        resolvePromotedDuplicateReview({
          review_status: status,
          reviewed_by: null,
          ai_usability: verdict({ usable: true }),
        }).reopen,
      ).toBe(false);
    }
  });

  it("treats a missing usability verdict as no independent condemnation", () => {
    // Pre-AI or un-analysed files must still reopen — the old behaviour for
    // everything the AI never judged.
    expect(
      resolvePromotedDuplicateReview({
        review_status: "rejected",
        reviewed_by: null,
        ai_usability: null,
      }).reopen,
    ).toBe(true);
  });
});
