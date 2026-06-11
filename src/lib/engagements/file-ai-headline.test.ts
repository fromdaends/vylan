import { describe, it, expect } from "vitest";
import { pickAiHeadline } from "./file-ai-headline";

const base = {
  analyzed: true,
  stale: false,
  usable: true as boolean | null,
  aiRejected: false,
  rejectionCount: 0,
  typeConcern: false,
  lowConfidence: false,
};

describe("pickAiHeadline", () => {
  it("shows analyzing while the read is in flight", () => {
    expect(pickAiHeadline({ ...base, analyzed: false })).toEqual({
      kind: "analyzing",
      tone: "neutral",
    });
  });

  it("shows not_analyzed once a never-run read goes stale", () => {
    expect(pickAiHeadline({ ...base, analyzed: false, stale: true })).toEqual({
      kind: "not_analyzed",
      tone: "neutral",
    });
  });

  it("greenlights a usable, right-type, confident document", () => {
    expect(pickAiHeadline(base)).toEqual({ kind: "looks_right", tone: "good" });
  });

  it("hedges a usable right-type doc the model wasn't sure about", () => {
    expect(pickAiHeadline({ ...base, lowConfidence: true })).toEqual({
      kind: "low_confidence",
      tone: "warn",
    });
  });

  it("flags the wrong slip even when readable", () => {
    expect(pickAiHeadline({ ...base, typeConcern: true })).toEqual({
      kind: "wrong_type",
      tone: "bad",
    });
  });

  it("a usability problem outranks the type read", () => {
    // Wrong type AND unusable → the unusable verdict leads (re-send needed).
    expect(
      pickAiHeadline({
        ...base,
        usable: false,
        aiRejected: true,
        typeConcern: true,
      }),
    ).toEqual({ kind: "auto_rejected", tone: "warn" });
  });

  it("escalates after two strikes on an auto-rejected file", () => {
    expect(
      pickAiHeadline({
        ...base,
        usable: false,
        aiRejected: true,
        rejectionCount: 2,
      }),
    ).toEqual({ kind: "escalated", tone: "bad" });
  });

  it("flags an unusable file the system did not auto-reject", () => {
    expect(pickAiHeadline({ ...base, usable: false, aiRejected: false })).toEqual(
      { kind: "flagged", tone: "warn" },
    );
  });

  it("treats a missing usability verdict (null) as no usability problem", () => {
    expect(pickAiHeadline({ ...base, usable: null })).toEqual({
      kind: "looks_right",
      tone: "good",
    });
    expect(
      pickAiHeadline({ ...base, usable: null, typeConcern: true }),
    ).toEqual({ kind: "wrong_type", tone: "bad" });
  });
});
