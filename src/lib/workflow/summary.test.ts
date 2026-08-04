import { describe, it, expect } from "vitest";
import {
  bookkeepingWorkflow,
  onboardingWorkflow,
  returnTypeWorkflow,
} from "./definition";
import { workflowSummaryFacts } from "./summary";

describe("workflowSummaryFacts", () => {
  it("describes the return flow: 6 stages, letter+checklist+invoice, paid to finish", () => {
    expect(workflowSummaryFacts(returnTypeWorkflow())).toEqual({
      stageCount: 6,
      sendsLetter: true,
      activatesChecklist: true,
      sendsInvoice: true,
      taskCount: 4,
      finalCondition: "invoice_paid",
    });
  });

  it("describes bookkeeping: 5 stages (no signature), completes when the invoice is sent", () => {
    const f = workflowSummaryFacts(bookkeepingWorkflow());
    expect(f.stageCount).toBe(5);
    expect(f.sendsLetter).toBe(false);
    expect(f.finalCondition).toBe("invoice_sent");
    expect(f.taskCount).toBe(2);
  });

  it("describes onboarding: 3 stages, done after your review", () => {
    const f = workflowSummaryFacts(onboardingWorkflow());
    expect(f.stageCount).toBe(3);
    expect(f.sendsInvoice).toBe(false);
    expect(f.finalCondition).toBe("manual");
  });
});
