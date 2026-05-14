import { describe, it, expect } from "vitest";
import { __test } from "./usability-badge";
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

  it("returns 'auto_rejected' when ai_rejected is true and strikes < 2", () => {
    expect(__test.pickState(UNUSABLE, true, 0)).toBe("auto_rejected");
    expect(__test.pickState(UNUSABLE, true, 1)).toBe("auto_rejected");
  });

  it("returns 'escalated' when ai_rejected and strikes have reached 2+", () => {
    expect(__test.pickState(UNUSABLE, true, 2)).toBe("escalated");
    expect(__test.pickState(UNUSABLE, true, 7)).toBe("escalated");
  });

  it("does NOT escalate when ai_rejected is false even with high strikes", () => {
    // High strike count alone doesn't escalate — the system needs to
    // have actually rejected this specific file.
    expect(__test.pickState(UNUSABLE, false, 5)).toBe("flagged");
  });
});
