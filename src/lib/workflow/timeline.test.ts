import { describe, it, expect } from "vitest";
import { returnTypeWorkflow, bookkeepingWorkflow } from "./definition";
import { buildFlowTimeline, type WorkflowEventRow } from "./timeline";

function ev(
  stage: string,
  action: string,
  status: "done" | "failed" | "skipped" = "done",
  detail: Record<string, unknown> = {},
  at = "2026-08-06T12:00:00Z",
): WorkflowEventRow {
  return { stage, action, status, detail, created_at: at };
}

const baseFacts = {
  status: "in_progress",
  stage: null,
  sentAt: null,
  acceptedAt: null,
  hasProposalItems: true,
  pendingGateStage: null,
  events: [] as WorkflowEventRow[],
};

describe("buildFlowTimeline", () => {
  it("tells the in-flight story: sent+letter, accepted, entered stages, current gate", () => {
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      {
        ...baseFacts,
        stage: "in_review",
        sentAt: "2026-08-01T10:00:00Z",
        acceptedAt: "2026-08-02T10:00:00Z",
        pendingGateStage: "in_review",
        events: [
          ev("sent", "send_engagement_letter"),
          ev("collecting", "entered", "done", {}, "2026-08-02T10:00:01Z"),
          ev("collecting", "activate_checklist"),
          ev("in_review", "entered", "done", {}, "2026-08-05T10:00:00Z"),
          ev("in_review", "materialize_tasks", "done", { count: 1 }),
        ],
      },
      { flowSendsLetter: true },
    );
    expect(tl.sent).toEqual({ state: "done", at: "2026-08-01T10:00:00Z" });
    expect(tl.letter).toEqual({ status: "done", reason: null });
    expect(tl.acceptance).toEqual({
      state: "done",
      at: "2026-08-02T10:00:00Z",
    });
    const byStage = Object.fromEntries(tl.stages.map((s) => [s.line.stage, s]));
    expect(byStage.collecting.state).toBe("passed");
    expect(byStage.collecting.fired.map((f) => f.action)).toEqual([
      "activate_checklist",
    ]);
    expect(byStage.in_review.state).toBe("current");
    expect(byStage.in_review.gateWaiting).toBe(true);
    expect(byStage.in_review.enteredAt).toBe("2026-08-05T10:00:00Z");
    expect(byStage.in_preparation.state).toBe("upcoming");
    expect(tl.failures).toEqual([]);
  });

  it("a failed letter and a failed invoice surface as failures, in time order", () => {
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      {
        ...baseFacts,
        stage: "awaiting_payment",
        sentAt: "2026-08-01T10:00:00Z",
        acceptedAt: "2026-08-01T11:00:00Z",
        events: [
          ev("sent", "send_engagement_letter", "failed", { reason: "signwell" }, "2026-08-01T10:00:05Z"),
          ev("awaiting_payment", "entered", "done", {}, "2026-08-03T10:00:00Z"),
          ev("awaiting_payment", "send_invoice", "failed", { reason: "exception" }, "2026-08-03T10:00:01Z"),
        ],
      },
      { flowSendsLetter: true },
    );
    expect(tl.letter).toEqual({ status: "failed", reason: "signwell" });
    expect(tl.failures.map((f) => f.action)).toEqual([
      "send_engagement_letter",
      "send_invoice",
    ]);
  });

  it("complete reads every planned stage as passed, even ones never entered", () => {
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      {
        ...baseFacts,
        status: "complete",
        sentAt: "2026-08-01T10:00:00Z",
        acceptedAt: "2026-08-01T11:00:00Z",
        events: [ev("collecting", "entered")],
      },
      { flowSendsLetter: false },
    );
    expect(tl.stages.every((s) => s.state === "passed")).toBe(true);
    expect(tl.letter).toBeNull();
  });

  it("a plain document request has no acceptance row; a draft plans everything", () => {
    const doc = buildFlowTimeline(
      bookkeepingWorkflow(),
      { ...baseFacts, hasProposalItems: false, stage: "collecting" },
      { flowSendsLetter: false },
    );
    expect(doc.acceptance).toBeNull();

    const draft = buildFlowTimeline(
      returnTypeWorkflow(),
      { ...baseFacts, status: "draft" },
      { flowSendsLetter: true },
    );
    expect(draft.sent.state).toBe("upcoming");
    expect(draft.letter).toEqual({ status: "planned", reason: null });
    expect(draft.acceptance).toEqual({ state: "upcoming", at: null });
    expect(draft.stages.every((s) => s.state === "upcoming")).toBe(true);
  });

  it("stays silent about the letter on engagements sent before the flow owned it", () => {
    // Sent, flow says letter, but no 'sent' ledger row (pre-#1475 history):
    // claiming done or failed would both be guesses.
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      { ...baseFacts, stage: "collecting", sentAt: "2026-07-01T10:00:00Z" },
      { flowSendsLetter: true },
    );
    expect(tl.letter).toBeNull();
  });

  it("acceptance waits whenever the engine's hold is live — not only at sent", () => {
    const atSent = buildFlowTimeline(
      returnTypeWorkflow(),
      { ...baseFacts, status: "sent", sentAt: "2026-08-01T10:00:00Z" },
      { flowSendsLetter: false },
    );
    expect(atSent.acceptance).toEqual({ state: "waiting", at: null });

    // Portal activity flips status to in_progress without acceptance; the
    // engine still holds the whole flow, and the card must say why.
    const inProgress = buildFlowTimeline(
      returnTypeWorkflow(),
      { ...baseFacts, stage: null, sentAt: "2026-08-01T10:00:00Z" },
      { flowSendsLetter: false },
    );
    expect(inProgress.acceptance).toEqual({ state: "waiting", at: null });

    // Completed by hand without ever being accepted: a permanently pending
    // step would be a lie — the row is dropped.
    const completedUnaccepted = buildFlowTimeline(
      returnTypeWorkflow(),
      { ...baseFacts, status: "complete", sentAt: "2026-08-01T10:00:00Z" },
      { flowSendsLetter: false },
    );
    expect(completedUnaccepted.acceptance).toBeNull();
  });

  it("position alone proves passage: stages behind current read passed without ledger rows", () => {
    // Manual stage override / flag-off window: no 'entered' rows were ever
    // written for the stages the jump crossed.
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      {
        ...baseFacts,
        stage: "awaiting_payment",
        sentAt: "2026-08-01T10:00:00Z",
        acceptedAt: "2026-08-01T11:00:00Z",
        events: [],
      },
      { flowSendsLetter: false },
    );
    const byStage = Object.fromEntries(tl.stages.map((s) => [s.line.stage, s]));
    expect(byStage.collecting.state).toBe("passed");
    expect(byStage.collecting.enteredAt).toBeNull();
    expect(byStage.in_review.state).toBe("passed");
    expect(byStage.awaiting_payment.state).toBe("current");
    expect(byStage.completed.state).toBe("upcoming");
  });

  it("a regressed stage keeps its fired history but reads upcoming again", () => {
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      {
        ...baseFacts,
        stage: "collecting",
        sentAt: "2026-08-01T10:00:00Z",
        acceptedAt: "2026-08-01T11:00:00Z",
        events: [
          ev("collecting", "entered"),
          ev("awaiting_payment", "entered"),
          ev("awaiting_payment", "send_invoice"),
        ],
      },
      { flowSendsLetter: false },
    );
    const pay = tl.stages.find((s) => s.line.stage === "awaiting_payment")!;
    expect(pay.state).toBe("upcoming");
    expect(pay.fired.map((f) => f.action)).toEqual(["send_invoice"]);
  });
});

describe("editor-mode letter (awaiting placement)", () => {
  it("ledger-done + live-pending reads as preparing, not sent", () => {
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      {
        ...baseFacts,
        status: "sent",
        sentAt: "2026-08-07T10:00:00Z",
        letterLiveStatus: "pending",
        events: [ev("sent", "send_engagement_letter")],
      },
      { flowSendsLetter: true },
    );
    expect(tl.letter).toEqual({ status: "preparing", reason: null });
  });

  it("once the live row moves past pending, the letter reads done", () => {
    const tl = buildFlowTimeline(
      returnTypeWorkflow(),
      {
        ...baseFacts,
        status: "sent",
        sentAt: "2026-08-07T10:00:00Z",
        letterLiveStatus: "sent",
        events: [ev("sent", "send_engagement_letter")],
      },
      { flowSendsLetter: true },
    );
    expect(tl.letter).toEqual({ status: "done", reason: null });
  });
});
