import { describe, it, expect } from "vitest";
import {
  bookkeepingWorkflow,
  buildWorkflowSnapshot,
  gstWorkflow,
  onboardingWorkflow,
  returnTypeWorkflow,
  type WorkflowDefinition,
  type WorkflowSnapshot,
} from "./definition";
import {
  pendingConfirmGate,
  resolveWorkflowStage,
  type WorkflowFacts,
} from "./resolve";

function snap(def: WorkflowDefinition): WorkflowSnapshot {
  return buildWorkflowSnapshot(def, {
    ownerId: "owner-1",
    staffId: "staff-1",
    activeMemberIds: new Set(["owner-1", "staff-1"]),
    fallbackId: "owner-1",
  });
}

// A live engagement with a 3-item checklist and nothing done yet. Every
// scenario below overrides only the facts that changed.
function facts(overrides: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    status: "sent",
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
    gates: {},
    signatureEverSent: false,
    completedSignatureCount: 0,
    signatureItemsUnsettled: 0,
    invoicePaid: false,
    stageTasksOpen: {},
    stageTasksMaterialized: {},
    ...overrides,
  };
}

const APPROVED = {
  checklistBlocked: 0,
  checklistApprovedOrNa: 3,
} as const;
const GATE = { by: "owner-1", at: "2026-08-04T00:00:00Z" } as const;

describe("the T1 walk (return-type flow)", () => {
  const wf = snap(returnTypeWorkflow());

  it("holds at collecting until every document is verified", () => {
    expect(resolveWorkflowStage(wf, facts())).toBe("collecting");
    expect(
      resolveWorkflowStage(
        wf,
        facts({ checklistBlocked: 0, checklistApprovedOrNa: 2 }),
      ),
    ).toBe("collecting");
  });

  it("advances to in_review on the last verification, then WAITS for the confirm tap", () => {
    const verified = facts(APPROVED);
    expect(resolveWorkflowStage(wf, verified)).toBe("in_review");
    // Even with later facts true, the unlatched gate stops the walk — a
    // confirm transition never advances by itself.
    expect(
      resolveWorkflowStage(wf, facts({ ...APPROVED, signatureEverSent: true })),
    ).toBe("in_review");
  });

  it("passes in_review once the gate is latched, then waits on the signature send", () => {
    expect(
      resolveWorkflowStage(wf, facts({ ...APPROVED, gates: { in_review: GATE } })),
    ).toBe("in_preparation");
    expect(
      resolveWorkflowStage(
        wf,
        facts({
          ...APPROVED,
          gates: { in_review: GATE },
          signatureEverSent: true,
          hasOutstandingSignature: true,
        }),
      ),
    ).toBe("awaiting_signature");
  });

  it("reaches awaiting_payment when signing finishes, completed when paid", () => {
    const signed = facts({
      ...APPROVED,
      gates: { in_review: GATE },
      signatureEverSent: true,
      completedSignatureCount: 1,
    });
    expect(resolveWorkflowStage(wf, signed)).toBe("awaiting_payment");
    expect(
      resolveWorkflowStage(wf, {
        ...signed,
        hasInvoice: true,
        invoicePaid: true,
      }),
    ).toBe("completed");
    // An unpaid invoice holds it.
    expect(
      resolveWorkflowStage(wf, {
        ...signed,
        hasInvoice: true,
        hasUnpaidInvoice: true,
      }),
    ).toBe("awaiting_payment");
  });

  it("moves BACKWARDS honestly when facts regress, without dropping the gate", () => {
    const prepared = facts({ ...APPROVED, gates: { in_review: GATE } });
    expect(resolveWorkflowStage(wf, prepared)).toBe("in_preparation");
    // A document is sent back: verification no longer holds.
    const regressed = {
      ...prepared,
      checklistBlocked: 1,
      checklistApprovedOrNa: 2,
    };
    expect(resolveWorkflowStage(wf, regressed)).toBe("collecting");
    // The replacement is approved: straight back to in_preparation — the
    // sticky gate means nobody re-approves a review they already did.
    expect(resolveWorkflowStage(wf, prepared)).toBe("in_preparation");
  });

  it("has no position for drafts and cancelled engagements", () => {
    expect(resolveWorkflowStage(wf, facts({ status: "draft" }))).toBeNull();
    expect(resolveWorkflowStage(wf, facts({ status: "cancelled" }))).toBeNull();
  });
});

describe("the bookkeeping walk (skip + stage tasks + invoice_sent)", () => {
  const wf = snap(bookkeepingWorkflow());

  it("never contains awaiting_signature", () => {
    // Fully done except signatures (which don't exist here): the walk jumps
    // from in_preparation's exit straight over the skipped stage.
    const done = facts({
      ...APPROVED,
      gates: { in_review: GATE },
      stageTasksMaterialized: { in_preparation: true },
      stageTasksOpen: { in_preparation: 0 },
    });
    expect(resolveWorkflowStage(wf, done)).toBe("awaiting_payment");
  });

  it("holds in_preparation until every stage task is checked off", () => {
    const base = facts({
      ...APPROVED,
      gates: { in_review: GATE },
      stageTasksMaterialized: { in_preparation: true },
      stageTasksOpen: { in_preparation: 2 },
    });
    expect(resolveWorkflowStage(wf, base)).toBe("in_preparation");
    expect(
      resolveWorkflowStage(wf, { ...base, stageTasksOpen: { in_preparation: 0 } }),
    ).toBe("awaiting_payment");
  });

  it("does NOT treat un-materialized tasks as done (no falling through on entry)", () => {
    const justEntered = facts({
      ...APPROVED,
      gates: { in_review: GATE },
      stageTasksMaterialized: {},
      stageTasksOpen: {},
    });
    expect(resolveWorkflowStage(wf, justEntered)).toBe("in_preparation");
  });

  it("completes when the invoice is SENT — payment keeps being chased after", () => {
    const invoiced = facts({
      ...APPROVED,
      gates: { in_review: GATE },
      stageTasksMaterialized: { in_preparation: true },
      stageTasksOpen: { in_preparation: 0 },
      hasInvoice: true,
      hasUnpaidInvoice: true,
    });
    expect(resolveWorkflowStage(wf, invoiced)).toBe("completed");
  });
});

describe("the GST walk (manual trigger) and onboarding (triple skip)", () => {
  it("GST: in_preparation advances on its own gate — the 'mark filed' tap", () => {
    const wf = snap(gstWorkflow());
    const reviewed = facts({ ...APPROVED, gates: { in_review: GATE } });
    expect(resolveWorkflowStage(wf, reviewed)).toBe("in_preparation");
    expect(
      resolveWorkflowStage(wf, {
        ...reviewed,
        gates: { in_review: GATE, in_preparation: GATE },
      }),
    ).toBe("awaiting_payment");
  });

  it("onboarding: review approval completes it, jumping three skipped stages", () => {
    const wf = snap(onboardingWorkflow());
    expect(resolveWorkflowStage(wf, facts(APPROVED))).toBe("in_review");
    expect(
      resolveWorkflowStage(wf, facts({ ...APPROVED, gates: { in_review: GATE } })),
    ).toBe("completed");
  });
});

describe("the engagement letter must not look like the return going out", () => {
  // THE TRAP (chunk 3): the return flow sends the letter on entering
  // collecting, and leaves in_preparation on `signature_request_sent`. If the
  // letter's own request counted, preparation would end the instant it began.
  // stage-sync answers signatureEverSent from NON-letter requests only; these
  // tests pin the resolver's half of that contract.
  const wf = snap(returnTypeWorkflow());
  const reviewed = facts({ ...APPROVED, gates: { in_review: GATE } });

  it("stays in preparation while only the letter has gone out", () => {
    // signatureEverSent is false because the sole request is the letter.
    expect(resolveWorkflowStage(wf, reviewed)).toBe("in_preparation");
  });

  it("moves on once the RETURN is sent for signature", () => {
    expect(
      resolveWorkflowStage(wf, { ...reviewed, signatureEverSent: true }),
    ).toBe("awaiting_signature");
  });

  it("still refuses to finish while the letter itself is unsigned", () => {
    // hasOutstandingSignature counts EVERY request, letter included — an
    // engagement whose letter was never signed is not a finished agreement.
    const signedReturn = {
      ...reviewed,
      signatureEverSent: true,
      completedSignatureCount: 1,
      hasOutstandingSignature: true,
    };
    expect(resolveWorkflowStage(wf, signedReturn)).toBe("awaiting_signature");
  });

  it("blocks on an unsettled letter checklist item too", () => {
    const signedReturn = {
      ...reviewed,
      signatureEverSent: true,
      completedSignatureCount: 1,
      signatureItemsUnsettled: 1,
    };
    expect(resolveWorkflowStage(wf, signedReturn)).toBe("awaiting_signature");
  });
});

describe("pendingConfirmGate — what surfaces as the approval prompt", () => {
  it("names the held transition once its condition is met", () => {
    const wf = snap(returnTypeWorkflow());
    expect(pendingConfirmGate(wf, facts())).toBeNull(); // still collecting
    expect(pendingConfirmGate(wf, facts(APPROVED))).toEqual({
      from: "in_review",
      to: "in_preparation",
    });
    expect(
      pendingConfirmGate(wf, facts({ ...APPROVED, gates: { in_review: GATE } })),
    ).toBeNull();
  });

  it("surfaces manual-automatic stages too (GST's mark-filed)", () => {
    const wf = snap(gstWorkflow());
    expect(
      pendingConfirmGate(wf, facts({ ...APPROVED, gates: { in_review: GATE } })),
    ).toEqual({ from: "in_preparation", to: "awaiting_payment" });
  });

  it("skips drafts and completed walks", () => {
    const wf = snap(onboardingWorkflow());
    expect(pendingConfirmGate(wf, facts({ status: "draft" }))).toBeNull();
    expect(
      pendingConfirmGate(wf, facts({ ...APPROVED, gates: { in_review: GATE } })),
    ).toBeNull();
  });
});
