import { describe, it, expect } from "vitest";
import {
  bookkeepingWorkflow,
  onboardingWorkflow,
  returnTypeWorkflow,
} from "./definition";
import { flowSendsInvoice, flowSendsLetter, workflowPlan } from "./plan";

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
