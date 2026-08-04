// The workflow-aware stage resolver — the walk.
//
// Where legacy resolveStage (stage.ts) hardcodes one shape, this walks the
// engagement's own snapshot: start at the first non-skipped stage and keep
// moving while each stage's advance condition is satisfied. Everything the
// legacy resolver got for free is preserved:
//
//   * Facts-based, not event-based: a webhook replay or a re-sync computes the
//     same answer. Stages go BACKWARDS honestly when facts regress (a rejected
//     document pulls a bookkeeping job out of in_preparation back to
//     collecting), because the walk simply stops earlier.
//   * Skips need no special case at transition time: a skipped stage is not in
//     the order, so advancing "jumps" it by construction.
//   * A confirm gate is a latch (stage_gates), exactly like the existing
//     preparation_started_at — sticky on purpose, so a regress-and-recover
//     does not re-ask a human for an approval they already gave.
//
// PURE: types in, stage out. The facts loader lives in stage-sync.ts.

import type { EngagementStage } from "@/lib/engagements/stage";
import type { StageFacts } from "@/lib/engagements/stage";
import {
  workflowStageOrder,
  type StageGates,
  type WorkflowSnapshot,
  type WorkflowStageDef,
} from "./definition";

// Everything the walk needs beyond the legacy StageFacts.
export type WorkflowFacts = StageFacts & {
  // Confirm-gate latches from engagements.stage_gates.
  gates: StageGates;
  // Any signature request that actually went OUT (sent / viewed / completed).
  // A 'pending' draft the accountant is still placing fields on does not count.
  signatureEverSent: boolean;
  // At least one request finished signing.
  completedSignatureCount: number;
  // Signature-kind checklist items not yet settled (approved / na).
  signatureItemsUnsettled: number;
  // The single live invoice is PAID (waived/cancelled rows don't count either
  // way; a waived invoice is escaped via manual stage override, as today).
  invoicePaid: boolean;
  // Per stage: workflow-materialized tasks not yet done.
  stageTasksOpen: Partial<Record<EngagementStage, number>>;
  // Per stage: has task materialization run (the ledger row exists)? Without
  // this, stage_tasks_done would be vacuously true in the instant between
  // entering a stage and its tasks being created, and the walk would fall
  // straight through the stage.
  stageTasksMaterialized: Partial<Record<EngagementStage, boolean>>;
};

function conditionMet(
  stage: EngagementStage,
  def: WorkflowStageDef,
  f: WorkflowFacts,
): boolean {
  const adv = def.advance;
  if (!adv) return false;
  switch (adv.condition) {
    case "all_docs_verified":
      // Every counted checklist item cleared (approved) or excused (na) —
      // same denominator rule as the legacy resolver, so the two can never
      // disagree about what "all documents" means.
      return (
        f.checklistTotal > 0 && f.checklistApprovedOrNa === f.checklistTotal
      );
    case "signatures_completed":
      return (
        f.completedSignatureCount > 0 &&
        !f.hasOutstandingSignature &&
        f.signatureItemsUnsettled === 0
      );
    case "signature_request_sent":
      return f.signatureEverSent;
    case "invoice_paid":
      return f.invoicePaid;
    case "invoice_sent":
      // Creation IS the send in sendEngagementInvoice — a live request row
      // means the client has been billed.
      return f.hasInvoice;
    case "stage_tasks_done":
      return (
        f.stageTasksMaterialized[stage] === true &&
        (f.stageTasksOpen[stage] ?? 0) === 0
      );
    case "manual":
      return f.gates[stage] != null;
  }
}

function advanceSatisfied(
  stage: EngagementStage,
  def: WorkflowStageDef,
  f: WorkflowFacts,
): boolean {
  const adv = def.advance;
  if (!adv) return false;
  if (!conditionMet(stage, def, f)) return false;
  // Confirm mode: the condition being true only SURFACES the move; a human
  // latch is what lets it pass. (For condition "manual" the gate is both, so
  // this is a no-op there.)
  if (adv.mode === "confirm" && f.gates[stage] == null) return false;
  return true;
}

/**
 * Where this engagement stands under its own workflow, or null when it has no
 * workflow position at all (draft / cancelled — same rule as legacy).
 */
export function resolveWorkflowStage(
  wf: WorkflowSnapshot,
  f: WorkflowFacts,
): EngagementStage | null {
  if (f.status === "draft" || f.status === "cancelled") return null;

  const order = workflowStageOrder(wf);
  let current: EngagementStage = order[0];
  for (const s of order) {
    current = s;
    if (s === "completed") break;
    if (!advanceSatisfied(s, wf.stages[s], f)) break;
  }
  return current;
}

/**
 * The stage the walk is HELD at by an unlatched confirm gate whose condition
 * is otherwise met — i.e. "this move is waiting for a human tap". Null when
 * nothing is waiting. This is what surfaces as a stage-move prompt (and, in
 * Part B, as a `stage_move` suggestion row).
 */
export function pendingConfirmGate(
  wf: WorkflowSnapshot,
  f: WorkflowFacts,
): { from: EngagementStage; to: EngagementStage } | null {
  if (f.status === "draft" || f.status === "cancelled") return null;
  const current = resolveWorkflowStage(wf, f);
  if (!current || current === "completed") return null;

  const def = wf.stages[current];
  const adv = def.advance;
  if (!adv) return null;

  // Held here purely by the missing latch?
  const heldByGate =
    f.gates[current] == null &&
    (adv.condition === "manual" ||
      (adv.mode === "confirm" && conditionMet(current, def, f)));
  if (!heldByGate) return null;

  const order = workflowStageOrder(wf);
  const idx = order.indexOf(current);
  const to = order[idx + 1];
  return to ? { from: current, to } : null;
}
