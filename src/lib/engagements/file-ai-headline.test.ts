import { describe, it, expect } from "vitest";
import { deriveFileAi, pickAiHeadline, type FileAiInput } from "./file-ai-headline";

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

describe("deriveFileAi", () => {
  const NOW = 1_700_000_000_000;
  const fresh = new Date(NOW - 60_000).toISOString();
  const file = (over: Partial<FileAiInput>): FileAiInput => ({
    ai_classification: "t4",
    ai_confidence: 0.95,
    ai_usability: { usable: true },
    ai_rejected: false,
    ai_extracted_fields: { extracted_year: 2024, issuer_name: "Hydro-Québec" },
    review_status: "pending",
    uploaded_at: fresh,
    ...over,
  });
  const ctx = {
    expectedDocType: "t4" as const,
    expectedYear: 2024,
    clientName: null,
    rejectionCount: 0,
  };

  it("greenlights a confident, correct, usable document", () => {
    const v = deriveFileAi(file({}), ctx, NOW);
    expect(v.show).toBe(true);
    expect(v.headline).toEqual({ kind: "looks_right", tone: "good" });
    expect(v.detected).toBe("t4");
    expect(v.year).toBe(2024);
    expect(v.confidence).toBe(0.95);
  });

  it("flags the wrong document type with the mismatch", () => {
    const v = deriveFileAi(file({}), { ...ctx, expectedDocType: "rl1" }, NOW);
    expect(v.headline.kind).toBe("wrong_type");
    expect(v.headline.tone).toBe("bad");
    expect(v.mismatch?.kind).toBe("type_mismatch");
  });

  // Regression: the checklist used to feed matchDocument fields_confidence 0, so
  // a clean, readable, right-type T4 belonging to a STRANGER showed green "looks
  // right" here while the Preview (which passes the real value) flagged it. Now
  // both read the same field, so the two surfaces agree.
  it("flags a wrong-NAME document the Preview also flags (checklist↔preview parity)", () => {
    const v = deriveFileAi(
      file({
        ai_extracted_fields: {
          extracted_year: 2024,
          party_name: "Jane Smith",
          fields_confidence: 0.95,
        },
      }),
      { ...ctx, clientName: "Tyler Jette" },
      NOW,
    );
    expect(v.headline).toEqual({ kind: "wrong_type", tone: "bad" });
    expect(v.mismatch?.kind).toBe("identity_mismatch");
    expect(v.mismatch?.expected).toBe("Tyler Jette");
    expect(v.mismatch?.actual).toBe("Jane Smith");
  });

  it("flags a wrong tax YEAR", () => {
    const v = deriveFileAi(
      file({ ai_extracted_fields: { extracted_year: 2021, fields_confidence: 0.9 } }),
      ctx, // expectedYear 2024
      NOW,
    );
    expect(v.headline.kind).toBe("wrong_type");
    expect(v.mismatch?.kind).toBe("year_mismatch");
  });

  it("prioritises the identity flag over the year flag for the row reason", () => {
    const v = deriveFileAi(
      file({
        ai_extracted_fields: {
          extracted_year: 2021, // ALSO a year mismatch
          party_name: "Jane Smith",
          fields_confidence: 0.9,
        },
      }),
      { ...ctx, clientName: "Tyler Jette" },
      NOW,
    );
    expect(v.mismatch?.kind).toBe("identity_mismatch");
  });

  it("stays quiet when the field read is low-confidence (matcher's own gate)", () => {
    const v = deriveFileAi(
      file({
        ai_extracted_fields: {
          extracted_year: 2021,
          party_name: "Jane Smith",
          fields_confidence: 0.3, // below the 0.5 floor → no flag, by design
        },
      }),
      { ...ctx, clientName: "Tyler Jette" },
      NOW,
    );
    expect(v.headline).toEqual({ kind: "looks_right", tone: "good" });
    expect(v.mismatch).toBeNull();
  });

  it("surfaces a usability auto-rejection with its summary", () => {
    const v = deriveFileAi(
      file({
        ai_usability: {
          usable: false,
          issue_summary_en: "Not a T4 — a screenshot.",
          issue_summary_fr: "Pas un T4 — une capture.",
        },
        ai_rejected: true,
      }),
      ctx,
      NOW,
    );
    expect(v.headline.kind).toBe("auto_rejected");
    expect(v.isUsabilityProblem).toBe(true);
    expect(v.summaryEn).toContain("Not a T4");
  });

  it("escalates after two strikes", () => {
    const v = deriveFileAi(
      file({ ai_usability: { usable: false }, ai_rejected: true }),
      { ...ctx, rejectionCount: 2 },
      NOW,
    );
    expect(v.headline.kind).toBe("escalated");
  });

  it("shows nothing when an unanalyzed file was already decided", () => {
    const v = deriveFileAi(
      file({
        ai_classification: null,
        ai_confidence: null,
        ai_usability: null,
        review_status: "approved",
      }),
      ctx,
      NOW,
    );
    expect(v.show).toBe(false);
  });

  it("treats a long-unanalyzed file as not_analyzed, an in-flight one as analyzing", () => {
    const stale = deriveFileAi(
      file({
        ai_classification: null,
        ai_confidence: null,
        ai_usability: null,
        uploaded_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
      }),
      ctx,
      NOW,
    );
    expect(stale.headline.kind).toBe("not_analyzed");
    const inflight = deriveFileAi(
      file({ ai_classification: null, ai_confidence: null, ai_usability: null }),
      ctx,
      NOW,
    );
    expect(inflight.headline.kind).toBe("analyzing");
  });
});
