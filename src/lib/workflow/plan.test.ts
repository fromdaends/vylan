import { describe, it, expect } from "vitest";
import {
  bookkeepingWorkflow,
  onboardingWorkflow,
  returnTypeWorkflow,
} from "./definition";
import {
  flowSendsInvoice,
  flowSendsLetter,
  withFlowLetter,
  workflowPlan,
} from "./plan";

describe("workflowPlan", () => {
  it("yields one line per working stage, in walk order, skips removed", () => {
    const lines = workflowPlan(bookkeepingWorkflow());
    expect(lines.map((l) => l.stage)).toEqual([
      "collecting",
      "in_review",
      "in_preparation",
      "awaiting_payment",
      "completed",
    ]);
  });

  it("carries the facts each surface needs to write its sentence", () => {
    const lines = workflowPlan(returnTypeWorkflow());
    const collecting = lines[0];
    expect(collecting.actions).toEqual([
      "send_engagement_letter",
      "activate_checklist",
    ]);
    expect(collecting.assignee).toBe("staff");
    expect(collecting.advance).toEqual({
      condition: "all_docs_verified",
      mode: "automatic",
    });
    const prep = lines.find((l) => l.stage === "in_preparation");
    expect(prep?.taskCount).toBe(3);
    expect(lines.at(-1)?.advance).toBeNull();
  });

  it("answers the invoice and letter ownership questions per flow", () => {
    expect(flowSendsInvoice(returnTypeWorkflow())).toBe(true);
    expect(flowSendsInvoice(onboardingWorkflow())).toBe(false);
    expect(flowSendsLetter(returnTypeWorkflow())).toBe(true);
    expect(flowSendsLetter(bookkeepingWorkflow())).toBe(false);
  });
});

describe("withFlowLetter", () => {
  it("off strips the letter from EVERY stage, wherever an old editor put it", () => {
    // Simulate a pre-fix flow where someone toggled the letter onto a later
    // stage too — off must clean up all of them, not just collecting.
    const def = returnTypeWorkflow();
    def.stages.in_review = {
      ...def.stages.in_review,
      on_entry: ["send_engagement_letter", ...def.stages.in_review.on_entry],
    };
    const next = withFlowLetter(def, false);
    expect(flowSendsLetter(next)).toBe(false);
    // The other actions on those stages survive untouched.
    expect(next.stages.collecting.on_entry).toEqual(["activate_checklist"]);
    expect(next.stages.in_review.on_entry).toEqual(["notify_assignee"]);
  });

  it("on writes it once, to collecting, and is idempotent", () => {
    const on1 = withFlowLetter(bookkeepingWorkflow(), true);
    const on2 = withFlowLetter(on1, true);
    expect(flowSendsLetter(on2)).toBe(true);
    expect(
      on2.stages.collecting.on_entry.filter(
        (a) => a === "send_engagement_letter",
      ),
    ).toHaveLength(1);
  });

  it("does not mutate the input definition", () => {
    const def = returnTypeWorkflow();
    withFlowLetter(def, false);
    expect(flowSendsLetter(def)).toBe(true);
  });
});
