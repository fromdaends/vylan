import { describe, it, expect } from "vitest";
import type { FileAiInput } from "@/lib/engagements/file-ai-headline";
import type { DocType } from "@/lib/db/templates";
import {
  aiBinaryFromKind,
  classifyFourCase,
  isSystemAutoReject,
  scoreFile,
  type AiScorableFile,
} from "./ai-verdict";

const NOW = Date.parse("2026-07-21T23:03:00Z");

// A clean, confident, right-type, usable T4 → the checklist shows "looks right".
function passingFile(
  review_status: "approved" | "rejected",
): FileAiInput {
  return {
    ai_classification: "t4",
    ai_confidence: 0.9,
    ai_usability: { usable: true },
    ai_rejected: false,
    ai_extracted_fields: {},
    review_status,
    uploaded_at: "2026-07-20T12:00:00Z",
  };
}

// Analyzed but the model judged it unusable → the checklist shows a flag.
function flaggedFile(
  review_status: "approved" | "rejected",
): FileAiInput {
  return {
    ai_classification: "t4",
    ai_confidence: 0.9,
    ai_usability: { usable: false, issue_summary_en: "Blurry scan" },
    ai_rejected: false,
    ai_extracted_fields: {},
    review_status,
    uploaded_at: "2026-07-20T12:00:00Z",
  };
}

function scorable(
  file: FileAiInput,
  decision: "approved" | "rejected",
): AiScorableFile {
  return {
    file,
    expectedDocType: "t4" as DocType,
    engagementTitle: "Smith — T4 slips", // no single 20xx → expectedYear null
    clientName: null,
    rejectionCount: 0,
    decision,
  };
}

describe("aiBinaryFromKind", () => {
  it("treats only looks_right as a pass", () => {
    expect(aiBinaryFromKind("looks_right")).toBe("pass");
    for (const k of [
      "low_confidence",
      "wrong_type",
      "flagged",
      "auto_rejected",
      "escalated",
    ]) {
      expect(aiBinaryFromKind(k)).toBe("flag");
    }
  });
});

describe("classifyFourCase", () => {
  it("crosses the AI call with the accountant decision", () => {
    expect(classifyFourCase("pass", "approved")).toBe("true_pass");
    expect(classifyFourCase("pass", "rejected")).toBe("false_pass");
    expect(classifyFourCase("flag", "rejected")).toBe("true_catch");
    expect(classifyFourCase("flag", "approved")).toBe("false_alarm");
  });
});

describe("isSystemAutoReject", () => {
  const autoReject = {
    review_status: "rejected" as const,
    reviewed_by: null,
    ai_rejected: true,
  };

  it("flags a system auto-rejection (rejected, no reviewer, ai_rejected)", () => {
    // This is the one that must NOT count — otherwise the AI agrees with itself.
    expect(isSystemAutoReject(autoReject)).toBe(true);
  });

  it("keeps a human override of an auto-reject (has a reviewer)", () => {
    expect(isSystemAutoReject({ ...autoReject, reviewed_by: "user-1" })).toBe(
      false,
    );
  });

  it("keeps a 0240-backfilled human rejection (no reviewer, ai_rejected false)", () => {
    expect(isSystemAutoReject({ ...autoReject, ai_rejected: false })).toBe(
      false,
    );
  });

  it("keeps approvals (an approval is always a human action)", () => {
    expect(
      isSystemAutoReject({
        review_status: "approved",
        reviewed_by: null,
        ai_rejected: true,
      }),
    ).toBe(false);
  });
});

describe("scoreFile (real deriveFileAi replay)", () => {
  it("AI looks-right + approved → true_pass", () => {
    expect(scoreFile(scorable(passingFile("approved"), "approved"), NOW)).toBe(
      "true_pass",
    );
  });

  it("AI looks-right + rejected → false_pass (the miss that matters)", () => {
    expect(scoreFile(scorable(passingFile("rejected"), "rejected"), NOW)).toBe(
      "false_pass",
    );
  });

  it("AI flagged + rejected → true_catch", () => {
    expect(scoreFile(scorable(flaggedFile("rejected"), "rejected"), NOW)).toBe(
      "true_catch",
    );
  });

  it("AI flagged + approved → false_alarm", () => {
    expect(scoreFile(scorable(flaggedFile("approved"), "approved"), NOW)).toBe(
      "false_alarm",
    );
  });
});
