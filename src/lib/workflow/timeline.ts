// The flow's TIMELINE, as structured facts — the engagement page's answer to
// "what did Vylan do, where is this job, what happens next". The builder's
// Automation step shows the same journey as a promise (plan.ts); this derives
// it as history, from the same plan lines plus the exactly-once ledger
// (workflow_stage_events), so the two surfaces can never tell different
// stories.
//
// PURE and total, like plan.ts: no I/O, junk-tolerant inputs, and a failed
// action is a first-class fact — the ledger burns claims on failure
// (at-most-once for client-facing sends), which makes this derivation the
// only place a silent miss becomes visible.

import type { EngagementStage } from "@/lib/engagements/stage";
import { ENGAGEMENT_STAGES } from "@/lib/engagements/stage";
import type { WorkflowDefinition } from "./definition";
import { workflowPlan, type WorkflowPlanLine } from "./plan";

/** One ledger row, as read from workflow_stage_events. `stage` is text on
 *  purpose: real stages plus the 'sent' pseudo-phase. */
export type WorkflowEventRow = {
  stage: string;
  action: string;
  status: "done" | "failed" | "skipped";
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type TimelineFacts = {
  /** draft | sent | in_progress | complete | cancelled — the agreement status. */
  status: string;
  /** engagements.stage — the resolver's current answer. Null = not staged. */
  stage: EngagementStage | null;
  sentAt: string | null;
  acceptedAt: string | null;
  /** Whether this engagement carries proposal items — without them there is
   *  no acceptance moment and the flow starts the instant it is sent. */
  hasProposalItems: boolean;
  /** The confirm gate currently waiting, when one is (stage it holds). */
  pendingGateStage: EngagementStage | null;
  events: WorkflowEventRow[];
};

export type LetterOutcome = {
  status: "planned" | "done" | "skipped" | "failed";
  /** already_signed | already_sent | not_configured | no_service | … */
  reason: string | null;
};

export type FiredAction = {
  action: string;
  status: "done" | "failed" | "skipped";
  reason: string | null;
  /** materialize_tasks carries how many to-dos landed. */
  count: number | null;
  /** assign carries who the work went to. */
  userId: string | null;
};

export type TimelineStageRow = {
  line: WorkflowPlanLine;
  state: "passed" | "current" | "upcoming";
  enteredAt: string | null;
  fired: FiredAction[];
  gateWaiting: boolean;
};

export type FlowTimeline = {
  sent: { state: "done" | "upcoming"; at: string | null };
  /** Null when the flow never sends one — the row simply doesn't exist. */
  letter: LetterOutcome | null;
  /** Null when nothing holds for acceptance (plain document requests). */
  acceptance: { state: "done" | "waiting" | "upcoming"; at: string | null } | null;
  stages: TimelineStageRow[];
  /** Every failed ledger row, in time order — the "needs you" list. */
  failures: FiredAction[];
};

function firedFromRow(row: WorkflowEventRow): FiredAction {
  const d = row.detail && typeof row.detail === "object" ? row.detail : {};
  const reason = typeof d.reason === "string" ? d.reason : null;
  const count = typeof d.count === "number" ? d.count : null;
  const userId = typeof d.user_id === "string" ? d.user_id : null;
  return { action: row.action, status: row.status, reason, count, userId };
}

export function buildFlowTimeline(
  def: WorkflowDefinition,
  facts: TimelineFacts,
  opts: { flowSendsLetter: boolean },
): FlowTimeline {
  const plan = workflowPlan(def);
  const sentHappened = facts.sentAt != null || facts.status !== "draft";

  // ── The letter, from the 'sent' pseudo-phase ────────────────────────────
  let letter: LetterOutcome | null = null;
  if (opts.flowSendsLetter) {
    const row = facts.events.find(
      (e) => e.stage === "sent" && e.action === "send_engagement_letter",
    );
    if (row) {
      const d = row.detail && typeof row.detail === "object" ? row.detail : {};
      letter = {
        status: row.status === "done" ? "done" : row.status,
        reason: typeof d.reason === "string" ? d.reason : null,
      };
    } else if (!sentHappened) {
      letter = { status: "planned", reason: null };
    }
    // Sent with no ledger row = sent before this flow owned the letter
    // (pre-#1475 rows). Claiming anything about it would be a guess — stay
    // silent rather than invent history.
  }

  // ── Acceptance ──────────────────────────────────────────────────────────
  // Mirrors the engine, not the status column: awaitingAcceptance holds the
  // WHOLE flow whenever proposal items exist and accepted_at is null — even
  // after portal activity flips status to in_progress. So "waiting" applies
  // any time the hold is live, not just at 'sent'; the one exception is a
  // job completed by hand without ever being accepted, where a permanently
  // pending step would be a lie — the row is dropped instead.
  let acceptance: FlowTimeline["acceptance"] = null;
  if (facts.acceptedAt) {
    acceptance = { state: "done", at: facts.acceptedAt };
  } else if (facts.hasProposalItems && facts.status !== "complete") {
    acceptance = {
      state: facts.status === "draft" ? "upcoming" : "waiting",
      at: null,
    };
  }

  // ── The stages, plan × ledger ───────────────────────────────────────────
  // Position comes from the CANONICAL order so a stage override parked on a
  // skipped stage still lands between its neighbours instead of reading as
  // "before everything".
  const canon = (s: EngagementStage | null): number =>
    s ? ENGAGEMENT_STAGES.indexOf(s) : -1;
  const isComplete = facts.status === "complete";
  const currentIdx = isComplete
    ? Number.POSITIVE_INFINITY
    : canon(facts.stage);

  const stages: TimelineStageRow[] = plan.map((line) => {
    const rows = facts.events.filter((e) => e.stage === line.stage);
    const entered = rows.find((e) => e.action === "entered") ?? null;
    // Everything except the entry marker itself, oldest first — the letter
    // never appears here (it lives on the 'sent' phase by construction).
    const fired = rows
      .filter((e) => e.action !== "entered")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(firedFromRow);

    const idx = canon(line.stage);
    // Position alone proves passage: being AT currentIdx means every earlier
    // plan stage is behind us, whether or not its 'entered' row exists (a
    // manual stage override and a flag-off window both advance the stage
    // without writing ledger rows). A passed-without-entered stage simply
    // shows no date — same concession the complete case makes.
    const state: TimelineStageRow["state"] =
      !isComplete && facts.stage === line.stage
        ? "current"
        : idx < currentIdx
          ? "passed"
          : "upcoming";
    return {
      line,
      state,
      enteredAt: entered?.created_at ?? null,
      fired,
      gateWaiting:
        state === "current" && facts.pendingGateStage === line.stage,
    };
  });

  const failures = facts.events
    .filter((e) => e.status === "failed")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(firedFromRow);

  return {
    sent: {
      state: sentHappened ? "done" : "upcoming",
      at: facts.sentAt,
    },
    letter,
    acceptance,
    stages,
    failures,
  };
}
