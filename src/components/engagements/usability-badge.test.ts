import { describe, it, expect } from "vitest";
import { __test } from "./usability-badge";
import { AUTO_REJECT_STRIKE_LIMIT } from "@/lib/ai/usability";
import {
  USABLE_BY_DEFAULT,
  type UsabilityVerdict,
} from "@/lib/ai/usability";

const UNUSABLE: UsabilityVerdict = {
  usable: false,
  confidence: 0.92,
  primary_issue: "text_unreadable",
  all_issues: ["text_unreadable"],
  issue_summary_fr: "Le texte est illisible.",
  issue_summary_en: "The text is not readable.",
};

describe("UsabilityBadge.pickState", () => {
  it("returns null when the AI thinks the file is usable", () => {
    expect(
      __test.pickState(
        { ...USABLE_BY_DEFAULT, usable: true },
        false,
        0,
      ),
    ).toBeNull();
  });

  it("returns null on the safe-default verdict (confidence 0, usable true)", () => {
    expect(__test.pickState(USABLE_BY_DEFAULT, false, 0)).toBeNull();
  });

  it("returns 'flagged' when unusable but the system did not auto-act", () => {
    // Firm has auto-reject off, or AI confidence below threshold —
    // the file is flagged but no client message has gone out.
    expect(__test.pickState(UNUSABLE, false, 0)).toBe("flagged");
  });

  // Every strike BELOW the limit was genuinely auto-rejected and did email the
  // client, so the badge must say so. The old code compared against a hardcoded
  // 2 while the router escalates at AUTO_REJECT_STRIKE_LIMIT (5), so strikes 2-4
  // displayed "Needs review" for documents the client had already been asked
  // to redo — the accountant was told to act on something already handled.
  it("returns 'auto_rejected' for every strike below the router's limit", () => {
    for (let strikes = 0; strikes < AUTO_REJECT_STRIKE_LIMIT; strikes++) {
      expect(__test.pickState(UNUSABLE, true, strikes)).toBe("auto_rejected");
    }
  });

  it("returns 'escalated' only once the router's strike limit is reached", () => {
    expect(__test.pickState(UNUSABLE, true, AUTO_REJECT_STRIKE_LIMIT)).toBe("escalated");
    expect(__test.pickState(UNUSABLE, true, AUTO_REJECT_STRIKE_LIMIT + 2)).toBe("escalated");
  });

  it("does NOT escalate when ai_rejected is false even with high strikes", () => {
    // High strike count alone doesn't escalate — the system needs to
    // have actually rejected this specific file.
    expect(__test.pickState(UNUSABLE, false, 5)).toBe("flagged");
  });
});
