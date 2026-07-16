import { describe, it, expect } from "vitest";
import {
  ENGAGEMENT_STAGES,
  STAGE_HISTORY_LIMIT,
  appendStageHistory,
  applicableStages,
  checklistFacts,
  isEngagementStage,
  parseStageHistory,
  resolveStage,
  stageEnteredAt,
  stageIndex,
  type EngagementStage,
  type StageChecklistItem,
  type StageFacts,
} from "./stage";

// A live engagement that has just been sent: three required documents, nothing
// in yet, no signatures, no invoice, no deliverables. Every test starts from
// here and changes only the fact under test, so each assertion names exactly the
// one thing that moved the stage.
function facts(over: Partial<StageFacts> = {}): StageFacts {
  return {
    status: "in_progress",
    checklistTotal: 3,
    checklistBlocked: 3,
    checklistApprovedOrNa: 0,
    hasSignatureItems: false,
    hasSignatureRequests: false,
    hasOutstandingSignature: false,
    hasInvoice: false,
    hasUnpaidInvoice: false,
    hasFinalDocuments: false,
    finalDocumentsReleased: false,
    preparationStarted: false,
    ...over,
  };
}

// Every document is in and cleared, nothing else has happened yet.
const allApproved = { checklistBlocked: 0, checklistApprovedOrNa: 3 };
// Every document is in, none decided on.
const allSubmitted = { checklistBlocked: 0, checklistApprovedOrNa: 0 };

describe("resolveStage — no workflow position", () => {
  it("a draft has no stage (it hasn't been sent)", () => {
    expect(resolveStage(facts({ status: "draft" }))).toBeNull();
  });

  it("a cancelled engagement has no stage", () => {
    expect(resolveStage(facts({ status: "cancelled" }))).toBeNull();
  });

  it("a draft stays stageless even when everything else is done", () => {
    expect(
      resolveStage(
        facts({
          status: "draft",
          ...allApproved,
          finalDocumentsReleased: true,
          hasFinalDocuments: true,
        }),
      ),
    ).toBeNull();
  });
});

describe("resolveStage — the happy path, in order", () => {
  it("sent, nothing uploaded -> collecting", () => {
    expect(resolveStage(facts({ status: "sent" }))).toBe("collecting");
  });

  it("all documents submitted, none decided -> in_review", () => {
    expect(resolveStage(facts(allSubmitted))).toBe("in_review");
  });

  it("all documents approved -> in_preparation", () => {
    expect(resolveStage(facts(allApproved))).toBe("in_preparation");
  });

  it("signature out with the client -> awaiting_signature", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasSignatureItems: true,
          hasSignatureRequests: true,
          hasOutstandingSignature: true,
        }),
      ),
    ).toBe("awaiting_signature");
  });

  it("signatures done, invoice owed -> awaiting_payment", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasSignatureItems: true,
          hasSignatureRequests: true,
          hasOutstandingSignature: false,
          hasInvoice: true,
          hasUnpaidInvoice: true,
        }),
      ),
    ).toBe("awaiting_payment");
  });

  it("work released, nothing owed -> completed", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasFinalDocuments: true,
          finalDocumentsReleased: true,
        }),
      ),
    ).toBe("completed");
  });
});

describe("resolveStage — skip logic", () => {
  it("no signature items: signing is skipped entirely (approved -> preparation -> completed)", () => {
    const f = facts({
      ...allApproved,
      hasSignatureItems: false,
      hasFinalDocuments: true,
      finalDocumentsReleased: true,
    });
    expect(resolveStage(f)).toBe("completed");
    expect(applicableStages(f)).not.toContain("awaiting_signature");
  });

  it("no invoice: payment is skipped (released work completes immediately)", () => {
    const f = facts({
      ...allApproved,
      hasInvoice: false,
      hasFinalDocuments: true,
      finalDocumentsReleased: true,
    });
    expect(resolveStage(f)).toBe("completed");
    expect(applicableStages(f)).not.toContain("awaiting_payment");
  });

  it("neither signatures nor invoice: collecting -> in_review -> in_preparation -> completed", () => {
    const base = { hasSignatureItems: false, hasInvoice: false };
    expect(resolveStage(facts(base))).toBe("collecting");
    expect(resolveStage(facts({ ...base, ...allSubmitted }))).toBe("in_review");
    expect(resolveStage(facts({ ...base, ...allApproved }))).toBe(
      "in_preparation",
    );
    expect(
      resolveStage(
        facts({
          ...base,
          ...allApproved,
          hasFinalDocuments: true,
          finalDocumentsReleased: true,
        }),
      ),
    ).toBe("completed");
  });
});

describe("resolveStage — the spec's conditional rules", () => {
  // "All signature requests completed -> if unpaid invoice exists ->
  //  awaiting_payment; else if final documents released -> completed; else stay
  //  in_preparation"
  const signingDone = {
    ...allApproved,
    hasSignatureItems: true,
    hasSignatureRequests: true,
    hasOutstandingSignature: false,
  };

  it("signatures done + unpaid invoice -> awaiting_payment", () => {
    expect(
      resolveStage(
        facts({ ...signingDone, hasInvoice: true, hasUnpaidInvoice: true }),
      ),
    ).toBe("awaiting_payment");
  });

  it("signatures done + no invoice + work released -> completed", () => {
    expect(
      resolveStage(
        facts({
          ...signingDone,
          hasFinalDocuments: true,
          finalDocumentsReleased: true,
        }),
      ),
    ).toBe("completed");
  });

  it("signatures done + nothing else -> stays in_preparation", () => {
    expect(resolveStage(facts(signingDone))).toBe("in_preparation");
  });

  // "Invoice paid -> completed if final documents released, otherwise
  //  in_preparation until they are"
  it("invoice paid but no deliverable yet -> in_preparation", () => {
    expect(
      resolveStage(
        facts({ ...allApproved, hasInvoice: true, hasUnpaidInvoice: false }),
      ),
    ).toBe("in_preparation");
  });

  it("invoice paid and work released -> completed", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasInvoice: true,
          hasUnpaidInvoice: false,
          hasFinalDocuments: true,
          finalDocumentsReleased: true,
        }),
      ),
    ).toBe("completed");
  });
});

describe("resolveStage — the deliverables lock", () => {
  // The lock is what makes the invoice rules compose: an unpaid LOCKING invoice
  // means the client cannot reach the finished work, so it isn't released.
  it("deliverable uploaded but locked behind an unpaid invoice -> awaiting_payment", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasInvoice: true,
          hasUnpaidInvoice: true,
          hasFinalDocuments: true,
          finalDocumentsReleased: false, // locked
        }),
      ),
    ).toBe("awaiting_payment");
  });

  it("paying lifts the lock and completes in one step", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasInvoice: true,
          hasUnpaidInvoice: false,
          hasFinalDocuments: true,
          finalDocumentsReleased: true,
        }),
      ),
    ).toBe("completed");
  });

  it("an unpaid NON-locking invoice still holds completion (the money is owed)", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasInvoice: true,
          hasUnpaidInvoice: true,
          hasFinalDocuments: true,
          finalDocumentsReleased: true, // not locked, client can download
        }),
      ),
    ).toBe("awaiting_payment");
  });
});

describe("resolveStage — preparation is reached by any real act of preparing", () => {
  it("the explicit Start preparation latch", () => {
    expect(resolveStage(facts({ preparationStarted: true, ...allSubmitted })))
      .toBe("in_preparation");
  });

  it("a signature request having ever existed", () => {
    expect(
      resolveStage(
        facts({
          ...allSubmitted,
          hasSignatureItems: true,
          hasSignatureRequests: true,
          hasOutstandingSignature: false,
        }),
      ),
    ).toBe("in_preparation");
  });

  it("a deliverable existing (even if still locked)", () => {
    expect(
      resolveStage(
        facts({ ...allSubmitted, hasFinalDocuments: true }),
      ),
    ).toBe("in_preparation");
  });

  it("an invoice ALONE does not imply preparation (0610 invoices at creation)", () => {
    // A brand-new engagement can be invoiced up front. That must not read as
    // "awaiting payment" while the client still owes every document.
    expect(
      resolveStage(facts({ hasInvoice: true, hasUnpaidInvoice: true })),
    ).toBe("collecting");
  });

  it("the Start latch HOLDS preparation even while a document is outstanding", () => {
    // This is the whole point of the button: the accountant clicks it precisely
    // BECAUSE they don't want to wait for every last document. If an
    // outstanding item pulled the stage back to collecting, "Start preparation"
    // would appear to do nothing in the exact situation it exists for.
    expect(
      resolveStage(facts({ preparationStarted: true, checklistBlocked: 1 })),
    ).toBe("in_preparation");
  });

  it("the latch does not outrank a signature actually out with the client", () => {
    // Preparation is where the firm works; awaiting_signature is further along.
    expect(
      resolveStage(
        facts({
          preparationStarted: true,
          hasSignatureItems: true,
          hasSignatureRequests: true,
          hasOutstandingSignature: true,
        }),
      ),
    ).toBe("awaiting_signature");
  });
});

describe("resolveStage — going backwards is correct", () => {
  it("rejecting a document returns an auto-prepared engagement to collecting", () => {
    // Preparation reached by clearing the checklist (NOT by the explicit latch,
    // which is a standing declaration and deliberately survives this).
    const prepared = facts(allApproved);
    expect(resolveStage(prepared)).toBe("in_preparation");
    // The accountant sends one document back: the client owes it again, and the
    // only thing that had put this at in_preparation is no longer true.
    expect(
      resolveStage({
        ...prepared,
        checklistBlocked: 1,
        checklistApprovedOrNa: 2,
      }),
    ).toBe("collecting");
  });

  it("pulling the last deliverable un-completes the stage", () => {
    const done = facts({
      ...allApproved,
      hasFinalDocuments: true,
      finalDocumentsReleased: true,
    });
    expect(resolveStage(done)).toBe("completed");
    expect(
      resolveStage({
        ...done,
        hasFinalDocuments: false,
        finalDocumentsReleased: false,
      }),
    ).toBe("in_preparation");
  });

  it("a re-locked invoice pulls a completed engagement back to awaiting_payment", () => {
    expect(
      resolveStage(
        facts({
          ...allApproved,
          hasInvoice: true,
          hasUnpaidInvoice: true,
          hasFinalDocuments: true,
          finalDocumentsReleased: false,
        }),
      ),
    ).toBe("awaiting_payment");
  });
});

describe("resolveStage — edge shapes", () => {
  it("an engagement with no checklist at all reads collecting, not in_review", () => {
    // in_review requires something to have been reviewed. An empty checklist has
    // nothing blocked, which must not be mistaken for "everything is in".
    expect(
      resolveStage(
        facts({
          checklistTotal: 0,
          checklistBlocked: 0,
          checklistApprovedOrNa: 0,
        }),
      ),
    ).toBe("collecting");
  });

  it("a signature-only engagement goes straight to awaiting_signature", () => {
    expect(
      resolveStage(
        facts({
          checklistTotal: 0,
          checklistBlocked: 0,
          checklistApprovedOrNa: 0,
          hasSignatureItems: true,
          hasSignatureRequests: true,
          hasOutstandingSignature: true,
        }),
      ),
    ).toBe("awaiting_signature");
  });

  it("a lifecycle-complete engagement can still read awaiting_payment", () => {
    // The spec's rule is one-way: stage completed => lifecycle Completed. The
    // reverse doesn't hold, and shouldn't — "I finished the work" and "they paid
    // me" are different facts.
    expect(
      resolveStage(
        facts({
          status: "complete",
          ...allApproved,
          hasInvoice: true,
          hasUnpaidInvoice: true,
          hasFinalDocuments: true,
          finalDocumentsReleased: false,
        }),
      ),
    ).toBe("awaiting_payment");
  });

  it("an outstanding signature outranks a still-blocked checklist", () => {
    // Furthest-along wins: the firm has visibly moved past collection, and the
    // separate attention system already surfaces what's blocked.
    expect(
      resolveStage(
        facts({
          checklistBlocked: 2,
          hasSignatureItems: true,
          hasSignatureRequests: true,
          hasOutstandingSignature: true,
        }),
      ),
    ).toBe("awaiting_signature");
  });
});

describe("applicableStages", () => {
  it("shows all six when the engagement has both signatures and an invoice", () => {
    expect(
      applicableStages(facts({ hasSignatureItems: true, hasInvoice: true })),
    ).toEqual([...ENGAGEMENT_STAGES]);
  });

  it("hides both optional stages for a plain collection engagement", () => {
    expect(applicableStages(facts())).toEqual([
      "collecting",
      "in_review",
      "in_preparation",
      "completed",
    ]);
  });

  it("always keeps canonical order", () => {
    const stages = applicableStages(facts({ hasSignatureItems: true }));
    const indexes = stages.map(stageIndex);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("includes the current stage even when the facts say it doesn't apply", () => {
    // A manual override can park an engagement somewhere it has no structural
    // claim to. The stepper still has to draw the node it's standing on.
    const stages = applicableStages(facts({ hasInvoice: false }), "awaiting_payment");
    expect(stages).toContain("awaiting_payment");
  });
});

describe("checklistFacts", () => {
  const item = (over: Partial<StageChecklistItem> = {}): StageChecklistItem => ({
    kind: "collection",
    required: true,
    status: "pending",
    rejection_reason: null,
    ...over,
  });

  it("ignores signature items — they're a separate axis", () => {
    const f = checklistFacts([
      item({ status: "approved" }),
      item({ kind: "signature", status: "pending" }),
    ]);
    expect(f.checklistTotal).toBe(1);
    expect(f.checklistBlocked).toBe(0);
    expect(f.checklistApprovedOrNa).toBe(1);
  });

  it("counts required items only, when any are required", () => {
    const f = checklistFacts([
      item({ required: true, status: "approved" }),
      item({ required: false, status: "pending" }),
    ]);
    expect(f.checklistTotal).toBe(1);
    expect(f.checklistBlocked).toBe(0);
  });

  it("falls back to ALL items when nothing is required", () => {
    // Without this, an all-optional engagement has nothing "blocked" and would
    // read in_review the instant it was sent.
    const f = checklistFacts([
      item({ required: false, status: "pending" }),
      item({ required: false, status: "pending" }),
    ]);
    expect(f.checklistTotal).toBe(2);
    expect(f.checklistBlocked).toBe(2);
  });

  it("an AI-bounced item is NOT blocked (a file exists to override)", () => {
    const f = checklistFacts([
      item({ status: "pending", rejection_reason: "blurry" }),
    ]);
    expect(f.checklistBlocked).toBe(0);
  });

  it("a truly pending item IS blocked", () => {
    const f = checklistFacts([item({ status: "pending", rejection_reason: null })]);
    expect(f.checklistBlocked).toBe(1);
  });

  it("a rejected item IS blocked (awaiting its replacement)", () => {
    const f = checklistFacts([item({ status: "rejected" })]);
    expect(f.checklistBlocked).toBe(1);
  });

  it("submitted is neither blocked nor cleared — it awaits a decision", () => {
    const f = checklistFacts([item({ status: "submitted" })]);
    expect(f.checklistBlocked).toBe(0);
    expect(f.checklistApprovedOrNa).toBe(0);
  });

  it("na counts as cleared (excused)", () => {
    const f = checklistFacts([item({ status: "na" })]);
    expect(f.checklistBlocked).toBe(0);
    expect(f.checklistApprovedOrNa).toBe(1);
  });

  it("an empty checklist is all zeroes", () => {
    expect(checklistFacts([])).toEqual({
      checklistTotal: 0,
      checklistBlocked: 0,
      checklistApprovedOrNa: 0,
    });
  });
});

describe("stage history", () => {
  const entry = (stage: EngagementStage, at: string, by = "auto") => ({
    stage,
    at,
    triggered_by: by,
  });

  it("appends in order", () => {
    const h = appendStageHistory([], entry("collecting", "2026-01-01T00:00:00Z"));
    expect(h).toHaveLength(1);
    expect(h[0].stage).toBe("collecting");
  });

  it("caps at the limit, dropping the oldest", () => {
    let h = Array.from({ length: STAGE_HISTORY_LIMIT }, (_, i) =>
      entry("collecting", `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`),
    );
    h = appendStageHistory(h, entry("completed", "2026-02-01T00:00:00Z"));
    expect(h).toHaveLength(STAGE_HISTORY_LIMIT);
    expect(h[h.length - 1].stage).toBe("completed");
    // The oldest entry fell off the front.
    expect(h[0].at).toBe("2026-01-01T00:00:01Z");
  });

  it("records a manual override against the user id", () => {
    const h = appendStageHistory(
      [],
      entry("in_preparation", "2026-01-01T00:00:00Z", "user-123"),
    );
    expect(h[0].triggered_by).toBe("user-123");
  });
});

describe("parseStageHistory", () => {
  it("returns [] for anything that isn't an array", () => {
    expect(parseStageHistory(null)).toEqual([]);
    expect(parseStageHistory(undefined)).toEqual([]);
    expect(parseStageHistory("nope")).toEqual([]);
    expect(parseStageHistory({})).toEqual([]);
  });

  it("drops malformed entries rather than throwing into a render", () => {
    const parsed = parseStageHistory([
      { stage: "collecting", at: "2026-01-01T00:00:00Z", triggered_by: "auto" },
      { stage: "not_a_stage", at: "2026-01-01T00:00:00Z", triggered_by: "auto" },
      { stage: "in_review", triggered_by: "auto" }, // no timestamp
      { stage: "in_review", at: "2026-01-01T00:00:00Z" }, // no actor
      null,
      "garbage",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].stage).toBe("collecting");
  });
});

describe("stageEnteredAt", () => {
  it("maps each stage to when it was entered", () => {
    const entered = stageEnteredAt([
      { stage: "collecting", at: "2026-01-01T00:00:00Z", triggered_by: "auto" },
      { stage: "in_review", at: "2026-01-05T00:00:00Z", triggered_by: "auto" },
    ]);
    expect(entered.collecting).toBe("2026-01-01T00:00:00Z");
    expect(entered.in_review).toBe("2026-01-05T00:00:00Z");
    expect(entered.completed).toBeUndefined();
  });

  it("a re-entered stage shows its MOST RECENT entry, not a stale first visit", () => {
    const entered = stageEnteredAt([
      { stage: "collecting", at: "2026-01-01T00:00:00Z", triggered_by: "auto" },
      { stage: "in_review", at: "2026-01-05T00:00:00Z", triggered_by: "auto" },
      // A document was rejected — back to collecting, then forward again.
      { stage: "collecting", at: "2026-01-06T00:00:00Z", triggered_by: "auto" },
      { stage: "in_review", at: "2026-01-09T00:00:00Z", triggered_by: "auto" },
    ]);
    expect(entered.collecting).toBe("2026-01-06T00:00:00Z");
    expect(entered.in_review).toBe("2026-01-09T00:00:00Z");
  });

  it("going backwards forgets the stages ahead", () => {
    const entered = stageEnteredAt([
      { stage: "in_preparation", at: "2026-01-05T00:00:00Z", triggered_by: "auto" },
      { stage: "collecting", at: "2026-01-06T00:00:00Z", triggered_by: "auto" },
    ]);
    // in_preparation will be entered again; its old timestamp is not the truth.
    expect(entered.in_preparation).toBeUndefined();
    expect(entered.collecting).toBe("2026-01-06T00:00:00Z");
  });
});

describe("isEngagementStage", () => {
  it("accepts every real stage", () => {
    for (const s of ENGAGEMENT_STAGES) expect(isEngagementStage(s)).toBe(true);
  });

  it("rejects anything else (it guards the manual-override action's input)", () => {
    expect(isEngagementStage("in_progress")).toBe(false);
    expect(isEngagementStage("")).toBe(false);
    expect(isEngagementStage(null)).toBe(false);
    expect(isEngagementStage(3)).toBe(false);
  });
});
