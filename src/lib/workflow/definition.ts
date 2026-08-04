// Workflow definitions — the founder's "automations": a named, per-stage
// playbook a template carries and an engagement snapshots at creation.
//
// PURE (types + parsing + defaults, no I/O), like stage.ts and agreement.ts,
// so the rules are provable in unit tests and every surface reads the same
// answer. The impure halves live in resolve-facts loading (stage-sync.ts) and
// the effects runner (effects.ts).
//
// READING IS TOTAL, the template-payload.ts rule: a definition saved today
// will be read by a later build, and one saved by a later build may be read by
// an older deployment mid-rollout. Unknown fields are dropped, missing fields
// get defaults, and anything structurally broken degrades to "no workflow" —
// which is the legacy behaviour, never a throw into a hot path.

import {
  ENGAGEMENT_STAGES,
  type EngagementStage,
} from "@/lib/engagements/stage";
import type { EngagementType } from "@/lib/db/templates";

export type StageAssigneeRule = "owner" | "staff" | { member_id: string };

export const ENTRY_ACTIONS = [
  "send_engagement_letter",
  "activate_checklist",
  "send_invoice",
  "notify_assignee",
] as const;
export type EntryAction = (typeof ENTRY_ACTIONS)[number];

export const ADVANCE_CONDITIONS = [
  "all_docs_verified",
  "signatures_completed",
  "signature_request_sent",
  "invoice_paid",
  "invoice_sent",
  "stage_tasks_done",
  "manual",
] as const;
export type AdvanceCondition = (typeof ADVANCE_CONDITIONS)[number];

export type AdvanceMode = "automatic" | "confirm";

export type WorkflowTaskDef = {
  title_en: string;
  title_fr: string;
  // Defaults to the stage assignee when absent.
  assignee?: StageAssigneeRule | null;
};

export type WorkflowStageDef = {
  skipped: boolean;
  assignee: StageAssigneeRule | null;
  on_entry: EntryAction[];
  tasks: WorkflowTaskDef[];
  // Null = no automatic exit (only `completed` in practice, plus any stage a
  // firm leaves manual-with-no-gate... which normalize prevents by coercing a
  // missing advance on a non-final stage to manual/confirm).
  advance: { condition: AdvanceCondition; mode: AdvanceMode } | null;
};

export type WorkflowDefinition = {
  version: 1;
  stages: Record<EngagementStage, WorkflowStageDef>;
};

// The engagement's copy: the definition plus assignees resolved to real user
// ids at instantiation (spec rule — resolution happens once, at creation).
export type WorkflowSnapshot = WorkflowDefinition & {
  assignees: Partial<Record<EngagementStage, string>>;
  // Provenance only. Never read through for behaviour.
  automation_id?: string | null;
};

// A latched confirm gate: who approved the move out of this stage, and when.
export type StageGate = { by: string; at: string };
export type StageGates = Partial<Record<EngagementStage, StageGate>>;

// ── Parsing (total) ──────────────────────────────────────────────────────────

function parseAssignee(v: unknown): StageAssigneeRule | null {
  if (v === "owner" || v === "staff") return v;
  if (v && typeof v === "object") {
    const id = (v as Record<string, unknown>).member_id;
    if (typeof id === "string" && id) return { member_id: id };
  }
  return null;
}

function parseTasks(v: unknown): WorkflowTaskDef[] {
  if (!Array.isArray(v)) return [];
  const out: WorkflowTaskDef[] = [];
  for (const t of v) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const en = typeof r.title_en === "string" ? r.title_en.trim() : "";
    const fr = typeof r.title_fr === "string" ? r.title_fr.trim() : "";
    // A title filled in one language mirrors into the other, so a task never
    // materializes blank in the engagement's language (same rule as
    // template-payload's label mirroring).
    if (!en && !fr) continue;
    out.push({
      title_en: en || fr,
      title_fr: fr || en,
      assignee: parseAssignee(r.assignee),
    });
  }
  return out;
}

function parseAdvance(
  v: unknown,
): { condition: AdvanceCondition; mode: AdvanceMode } | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const condition = (ADVANCE_CONDITIONS as readonly string[]).includes(
    r.condition as string,
  )
    ? (r.condition as AdvanceCondition)
    : // An unknown condition from a newer build must never auto-fire on an
      // older one — manual is the only always-safe reading.
      "manual";
  const mode: AdvanceMode = r.mode === "confirm" ? "confirm" : "automatic";
  return { condition, mode };
}

function parseStage(
  stage: EngagementStage,
  v: unknown,
): WorkflowStageDef {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const tasks = parseTasks(r.tasks);
  let advance = parseAdvance(r.advance);

  // stage_tasks_done over an empty task list is vacuously true and would let
  // the stage fall straight through the moment it is entered. Nothing sensible
  // means that; read it as manual.
  if (advance?.condition === "stage_tasks_done" && tasks.length === 0) {
    advance = { condition: "manual", mode: advance.mode };
  }

  const onEntry: EntryAction[] = Array.isArray(r.on_entry)
    ? (r.on_entry.filter((a) =>
        (ENTRY_ACTIONS as readonly string[]).includes(a as string),
      ) as EntryAction[])
    : [];

  return {
    // The guard rails from the spec: collecting and completed cannot be
    // skipped — an engagement always starts somewhere and always can finish.
    skipped:
      stage === "collecting" || stage === "completed"
        ? false
        : r.skipped === true,
    assignee: parseAssignee(r.assignee),
    on_entry: onEntry,
    tasks,
    advance: stage === "completed" ? null : advance,
  };
}

/**
 * Parse whatever came out of a jsonb column into a typed definition, or null
 * when there is no usable workflow at all (null column, garbage, wrong shape).
 * Null means "legacy behaviour", never an error.
 */
export function parseWorkflowDefinition(
  raw: unknown,
): WorkflowDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const stagesRaw = r.stages;
  if (!stagesRaw || typeof stagesRaw !== "object") return null;

  const stages = {} as Record<EngagementStage, WorkflowStageDef>;
  for (const s of ENGAGEMENT_STAGES) {
    stages[s] = parseStage(s, (stagesRaw as Record<string, unknown>)[s]);
  }
  return { version: 1, stages };
}

/** Parse an engagement's snapshot (definition + resolved assignees). */
export function parseWorkflowSnapshot(raw: unknown): WorkflowSnapshot | null {
  const def = parseWorkflowDefinition(raw);
  if (!def) return null;
  const r = raw as Record<string, unknown>;
  const assignees: Partial<Record<EngagementStage, string>> = {};
  if (r.assignees && typeof r.assignees === "object") {
    for (const s of ENGAGEMENT_STAGES) {
      const v = (r.assignees as Record<string, unknown>)[s];
      if (typeof v === "string" && v) assignees[s] = v;
    }
  }
  const automationId =
    typeof r.automation_id === "string" ? r.automation_id : null;
  return { ...def, assignees, automation_id: automationId };
}

/** The stages this workflow actually walks, in order (skips removed). */
export function workflowStageOrder(
  def: WorkflowDefinition,
): EngagementStage[] {
  return ENGAGEMENT_STAGES.filter((s) => !def.stages[s].skipped);
}

/** Parse engagements.stage_gates. Total: junk reads as "no gates latched". */
export function parseStageGates(raw: unknown): StageGates {
  if (!raw || typeof raw !== "object") return {};
  const out: StageGates = {};
  for (const s of ENGAGEMENT_STAGES) {
    const v = (raw as Record<string, unknown>)[s];
    if (!v || typeof v !== "object") continue;
    const by = (v as Record<string, unknown>).by;
    const at = (v as Record<string, unknown>).at;
    if (typeof by === "string" && typeof at === "string") {
      out[s] = { by, at };
    }
  }
  return out;
}

// ── Assignee resolution (at instantiation) ───────────────────────────────────

export type AssigneeContext = {
  // The firm's owner (first one, when several). Null when unresolvable.
  ownerId: string | null;
  // The engagement's assignee-of-record at creation — the builder's pick,
  // falling back to the creator upstream.
  staffId: string | null;
  // Active firm member ids; a named member outside this set falls back.
  activeMemberIds: ReadonlySet<string>;
  // Last-resort fallback (spec: the engagement creator).
  fallbackId: string | null;
};

export function resolveAssigneeRule(
  rule: StageAssigneeRule | null,
  ctx: AssigneeContext,
): string | null {
  const pick = (id: string | null): string | null =>
    id && ctx.activeMemberIds.has(id) ? id : null;
  if (rule === "owner") return pick(ctx.ownerId) ?? pick(ctx.fallbackId);
  if (rule === "staff") return pick(ctx.staffId) ?? pick(ctx.fallbackId);
  if (rule && typeof rule === "object") {
    return pick(rule.member_id) ?? pick(ctx.staffId) ?? pick(ctx.fallbackId);
  }
  return null;
}

/**
 * Freeze a definition into an engagement snapshot: every stage with an
 * assignee rule gets a concrete user id (or none, when nothing resolves).
 */
export function buildWorkflowSnapshot(
  def: WorkflowDefinition,
  ctx: AssigneeContext,
  automationId: string | null = null,
): WorkflowSnapshot {
  const assignees: Partial<Record<EngagementStage, string>> = {};
  for (const s of ENGAGEMENT_STAGES) {
    const resolved = resolveAssigneeRule(def.stages[s].assignee, ctx);
    if (resolved) assignees[s] = resolved;
  }
  return { ...def, assignees, automation_id: automationId };
}

// ── Family defaults ──────────────────────────────────────────────────────────
// The same four flows the migration seeds as built-in automations. Kept in
// code too so a template with no workflow (older clones, the blank template)
// still gets the right behaviour when the firm flag is on — and so tests can
// exercise the seeds without a database.

const NO_STAGE: WorkflowStageDef = {
  skipped: true,
  assignee: null,
  on_entry: [],
  tasks: [],
  advance: null,
};

function stageDef(partial: Partial<WorkflowStageDef>): WorkflowStageDef {
  return {
    skipped: false,
    assignee: null,
    on_entry: [],
    tasks: [],
    advance: null,
    ...partial,
  };
}

export const BUILTIN_AUTOMATION_IDS = {
  return: "00000000-0000-0000-0000-00000000a001",
  gst: "00000000-0000-0000-0000-00000000a002",
  bookkeeping: "00000000-0000-0000-0000-00000000a003",
  onboarding: "00000000-0000-0000-0000-00000000a004",
} as const;

export function returnTypeWorkflow(): WorkflowDefinition {
  return {
    version: 1,
    stages: {
      collecting: stageDef({
        assignee: "staff",
        on_entry: ["send_engagement_letter", "activate_checklist"],
        advance: { condition: "all_docs_verified", mode: "automatic" },
      }),
      in_review: stageDef({
        assignee: "owner",
        on_entry: ["notify_assignee"],
        tasks: [
          {
            title_en: "Review documents for completeness",
            title_fr: "Vérifier que les documents sont complets",
          },
        ],
        advance: { condition: "manual", mode: "confirm" },
      }),
      in_preparation: stageDef({
        assignee: "staff",
        tasks: [
          {
            title_en: "Prepare working papers",
            title_fr: "Préparer les papiers de travail",
          },
          {
            title_en: "Prepare the return",
            title_fr: "Préparer la déclaration",
          },
          { title_en: "Partner review", title_fr: "Révision par l'associé" },
        ],
        advance: { condition: "signature_request_sent", mode: "automatic" },
      }),
      awaiting_signature: stageDef({
        advance: { condition: "signatures_completed", mode: "automatic" },
      }),
      awaiting_payment: stageDef({
        on_entry: ["send_invoice"],
        advance: { condition: "invoice_paid", mode: "automatic" },
      }),
      completed: stageDef({}),
    },
  };
}

export function gstWorkflow(): WorkflowDefinition {
  return {
    version: 1,
    stages: {
      collecting: stageDef({
        assignee: "staff",
        on_entry: ["activate_checklist"],
        advance: { condition: "all_docs_verified", mode: "automatic" },
      }),
      in_review: stageDef({
        assignee: "owner",
        advance: { condition: "manual", mode: "confirm" },
      }),
      in_preparation: stageDef({
        assignee: "staff",
        advance: { condition: "manual", mode: "automatic" },
      }),
      awaiting_signature: NO_STAGE,
      awaiting_payment: stageDef({
        on_entry: ["send_invoice"],
        advance: { condition: "invoice_sent", mode: "automatic" },
      }),
      completed: stageDef({}),
    },
  };
}

export function bookkeepingWorkflow(): WorkflowDefinition {
  return {
    version: 1,
    stages: {
      collecting: stageDef({
        assignee: "staff",
        on_entry: ["activate_checklist"],
        advance: { condition: "all_docs_verified", mode: "automatic" },
      }),
      in_review: stageDef({
        assignee: "staff",
        advance: { condition: "manual", mode: "confirm" },
      }),
      in_preparation: stageDef({
        assignee: "staff",
        tasks: [
          {
            title_en: "Reconcile bank and credit card accounts",
            title_fr: "Concilier les comptes bancaires et cartes de crédit",
          },
          {
            title_en: "Post adjusting entries",
            title_fr: "Passer les écritures de régularisation",
          },
        ],
        advance: { condition: "stage_tasks_done", mode: "automatic" },
      }),
      awaiting_signature: NO_STAGE,
      awaiting_payment: stageDef({
        on_entry: ["send_invoice"],
        advance: { condition: "invoice_sent", mode: "automatic" },
      }),
      completed: stageDef({}),
    },
  };
}

export function onboardingWorkflow(): WorkflowDefinition {
  return {
    version: 1,
    stages: {
      collecting: stageDef({
        assignee: "staff",
        on_entry: ["send_engagement_letter", "activate_checklist"],
        advance: { condition: "all_docs_verified", mode: "automatic" },
      }),
      in_review: stageDef({
        assignee: "owner",
        advance: { condition: "manual", mode: "confirm" },
      }),
      in_preparation: NO_STAGE,
      awaiting_signature: NO_STAGE,
      awaiting_payment: NO_STAGE,
      completed: stageDef({}),
    },
  };
}

/**
 * The default flow for an engagement type — used when a template carries no
 * workflow of its own (older firm clones, the blank template, type-only
 * creation). Per the spec, custom starts from the return-type default.
 */
export function familyDefaultWorkflow(type: EngagementType): WorkflowDefinition {
  if (type === "bookkeeping") return bookkeepingWorkflow();
  return returnTypeWorkflow();
}
