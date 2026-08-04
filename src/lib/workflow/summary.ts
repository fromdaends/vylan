// The one-line description of a workflow — "6 stages · letter + checklist ·
// completes on payment" — as FACTS, not prose. The component owns the words
// (they're i18n'd); this owns the arithmetic, so the automations list, the
// template cards and anything else that summarizes a flow can never count
// differently.

import { workflowStageOrder, type AdvanceCondition, type WorkflowDefinition } from "./definition";

export type WorkflowSummaryFacts = {
  // Non-skipped stages.
  stageCount: number;
  sendsLetter: boolean;
  activatesChecklist: boolean;
  sendsInvoice: boolean;
  // Template tasks across all stages.
  taskCount: number;
  // What finishes the job: the advance condition of the last working stage
  // (the one right before `completed` in this flow's own order). Null only
  // for a flow whose last stage has no advance at all.
  finalCondition: AdvanceCondition | null;
};

export function workflowSummaryFacts(
  def: WorkflowDefinition,
): WorkflowSummaryFacts {
  const order = workflowStageOrder(def);
  const lastWorking = order[order.length - 2] ?? null;
  let sendsLetter = false;
  let activatesChecklist = false;
  let sendsInvoice = false;
  let taskCount = 0;
  for (const s of order) {
    const d = def.stages[s];
    if (d.on_entry.includes("send_engagement_letter")) sendsLetter = true;
    if (d.on_entry.includes("activate_checklist")) activatesChecklist = true;
    if (d.on_entry.includes("send_invoice")) sendsInvoice = true;
    taskCount += d.tasks.length;
  }
  return {
    stageCount: order.length,
    sendsLetter,
    activatesChecklist,
    sendsInvoice,
    taskCount,
    finalCondition: lastWorking
      ? (def.stages[lastWorking].advance?.condition ?? null)
      : null,
  };
}
