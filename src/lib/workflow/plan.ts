// The flow's PLAN, as structured facts — one line per working stage, in the
// order the engagement will actually live them.
//
// Two surfaces render this and must never disagree: the engagement builder's
// Automation step ("here is what this engagement will do") and the engagement
// page's timeline ("here is what it has done and what comes next"). The words
// belong to the components (i18n); the derivation lives here once, the same
// split buildWorkflowSummaryLine already uses for the one-line version.
//
// PURE and total: a malformed definition never reaches this (parse first),
// and a stage with nothing to say still yields its line — a plan with silent
// gaps reads as a plan with steps missing.

import type { EngagementStage } from "@/lib/engagements/stage";
import {
  workflowStageOrder,
  type AdvanceCondition,
  type AdvanceMode,
  type EntryAction,
  type StageAssigneeRule,
  type WorkflowDefinition,
} from "./definition";

export type WorkflowPlanLine = {
  stage: EngagementStage;
  /** Who the engagement is handed to when this stage begins (the RULE — the
   *  snapshot resolves it to a person at creation). */
  assignee: StageAssigneeRule | null;
  /** What fires the moment the stage begins, in template order. */
  actions: EntryAction[];
  /** Stage to-dos the flow itself materializes here. The builder's own Tasks
   *  step adds more on top; callers show that count separately. */
  taskCount: number;
  /** What moves the engagement PAST this stage, and whether a human tap is
   *  required. Null only on `completed`. */
  advance: { condition: AdvanceCondition; mode: AdvanceMode } | null;
};

export function workflowPlan(def: WorkflowDefinition): WorkflowPlanLine[] {
  return workflowStageOrder(def).map((stage) => {
    const s = def.stages[stage];
    return {
      stage,
      assignee: s.assignee,
      actions: s.on_entry,
      taskCount: s.tasks.length,
      advance: s.advance,
    };
  });
}

/** Does any stage of this flow raise the invoice itself? The same question
 *  the create action asks when it takes invoice timing over from the old
 *  per-engagement setting — exported so the builder's Billing step and the
 *  server can never answer it differently. */
export function flowSendsInvoice(def: WorkflowDefinition): boolean {
  return Object.values(def.stages).some((s) =>
    s.on_entry.includes("send_invoice"),
  );
}

/** Does any stage send the engagement letter? Decides whether the Automation
 *  step shows the per-service letter status at all. */
export function flowSendsLetter(def: WorkflowDefinition): boolean {
  return Object.values(def.stages).some((s) =>
    s.on_entry.includes("send_engagement_letter"),
  );
}

/**
 * Turn the flow's engagement letter on or off — the ONLY way an editor may
 * write it. The letter fires at SEND time (runWorkflowSendEffects), never at
 * stage entry, so it is one flow-level fact, not a per-stage action; but it
 * is still STORED as a collecting on_entry entry so every saved flow,
 * snapshot and older build keeps reading it without a data migration.
 * Off strips it from every stage, wherever an earlier editor left it.
 */
export function withFlowLetter(
  def: WorkflowDefinition,
  on: boolean,
): WorkflowDefinition {
  const stages = { ...def.stages };
  for (const key of Object.keys(stages) as EngagementStage[]) {
    const s = stages[key];
    if (s.on_entry.includes("send_engagement_letter")) {
      stages[key] = {
        ...s,
        on_entry: s.on_entry.filter((a) => a !== "send_engagement_letter"),
      };
    }
  }
  if (on) {
    stages.collecting = {
      ...stages.collecting,
      on_entry: ["send_engagement_letter", ...stages.collecting.on_entry],
    };
  }
  return { ...def, stages };
}
