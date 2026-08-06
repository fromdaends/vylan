// The impure half of the stage system: load an engagement's real facts, ask the
// pure resolver where it stands, and persist the answer.
//
// syncEngagementStage is THE function every event handler calls. There is no
// other writer of engagements.stage besides this file, and no caller anywhere
// decides a stage for itself — they just say "something happened to this
// engagement" and the resolver re-derives the truth. That's what keeps the six
// transitions in the spec from turning into scattered ad-hoc updates.
//
// AUTH CONTEXT: callers pass their own Supabase client, so this inherits it —
// the accountant's RLS-scoped session on server actions, service-role on the
// portal / webhook / AI-worker paths (where the engagement id comes from
// trusted server state, never client input). Nothing here widens access.
//
// PRE-MIGRATION: every read and write is best-effort. Before 0690 is applied,
// the stage columns don't exist, reads return "no stage", writes no-op, and the
// UI falls back to today's status pill. The feature is simply inert.
//
// FAIL-SOFT: a stage is a display convenience layered on data that is already
// correct. Nothing here may ever fail the action that triggered it — a client's
// upload, a webhook ack, an accountant's approve. Every entry point swallows its
// own errors and logs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueJob } from "@/lib/db/jobs";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { computeDeliverablesLocked } from "@/lib/portal/deliverable-access";
import { cancelEngagementReminders } from "@/lib/reminders";
import { logServiceRoleActivity } from "@/lib/db/activity";
import {
  appendStageHistory,
  checklistFacts,
  parseStageHistory,
  resolveStage,
  type EngagementStage,
  type StageChecklistItem,
  type StageFacts,
  type StageHistoryEntry,
} from "./stage";
import {
  parseStageGates,
  parseWorkflowSnapshot,
  type WorkflowSnapshot,
} from "@/lib/workflow/definition";
import {
  resolveWorkflowStage,
  type WorkflowFacts,
} from "@/lib/workflow/resolve";
import { runWorkflowStageEffects } from "@/lib/workflow/effects";
import { isWorkflowsEnabledForFirm } from "@/lib/workflow/flags";

// PostgREST: PGRST205 = table not in schema cache, PGRST204 = column missing;
// 42P01 / 42703 are the Postgres equivalents. Matched on CODE only — never on
// message text — so an unrelated failure that happens to mention a column can
// never be mistaken for "the migration isn't applied yet" and silently skipped.
function isMissingSchema(err: { code?: string | null } | null): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "PGRST204" ||
    err.code === "42P01" ||
    err.code === "42703"
  );
}

// The engagement columns the stage system reads. Kept narrow on purpose: this
// runs on hot paths (every upload, every AI verdict).
type StageEngagementRow = {
  id: string;
  firm_id: string;
  client_id: string;
  status: "draft" | "sent" | "in_progress" | "complete" | "cancelled";
  stage?: EngagementStage | null;
  stage_history?: unknown;
  preparation_started_at?: string | null;
  invoice_locks_deliverables?: boolean;
  invoice_auto_mode?: "off" | "on_acceptance" | "on_completion" | "delayed";
  invoice_delay_days?: number | null;
  completed_at?: string | null;
  // Workflow snapshot + confirm gates (migration 1560). Absent pre-1560 —
  // the middle select tier below — which reads as "no workflow": legacy path.
  workflow?: unknown;
  stage_gates?: unknown;
};

// Three select tiers, widest first, falling through on missing-schema errors —
// the same shape quickbooks-suggestions uses across its migration windows.
const WORKFLOW_COLUMNS =
  "id, firm_id, client_id, status, completed_at, invoice_auto_mode, invoice_delay_days, invoice_locks_deliverables, stage, stage_history, preparation_started_at, workflow, stage_gates";
const FULL_COLUMNS =
  "id, firm_id, client_id, status, completed_at, invoice_auto_mode, invoice_delay_days, invoice_locks_deliverables, stage, stage_history, preparation_started_at";
// Pre-0690 fallback: everything except the stage columns.
const BASE_COLUMNS =
  "id, firm_id, client_id, status, completed_at, invoice_auto_mode, invoice_delay_days, invoice_locks_deliverables";

async function loadEngagementRow(
  sb: SupabaseClient,
  engagementId: string,
): Promise<{ row: StageEngagementRow; hasStageColumns: boolean } | null> {
  const { data: wide, error: wideErr } = await sb
    .from("engagements")
    .select(WORKFLOW_COLUMNS)
    .eq("id", engagementId)
    .maybeSingle();
  if (!wideErr && wide) {
    return { row: wide as StageEngagementRow, hasStageColumns: true };
  }
  if (wideErr && !isMissingSchema(wideErr)) {
    console.error("[stage-sync] load engagement failed:", wideErr);
    return null;
  }
  // Pre-1560: no workflow columns. Everything else works as before.
  const { data, error } = await sb
    .from("engagements")
    .select(FULL_COLUMNS)
    .eq("id", engagementId)
    .maybeSingle();
  if (!error && data) {
    return { row: data as StageEngagementRow, hasStageColumns: true };
  }
  if (error && !isMissingSchema(error)) {
    console.error("[stage-sync] load engagement failed:", error);
    return null;
  }
  // Pre-0690: retry without the stage columns purely to learn the row exists.
  // Nothing downstream can write, so the sync will no-op.
  const { data: base } = await sb
    .from("engagements")
    .select(BASE_COLUMNS)
    .eq("id", engagementId)
    .maybeSingle();
  if (!base) return null;
  return { row: base as StageEngagementRow, hasStageColumns: false };
}

// Gather everything resolveStage needs, in four small parallel queries. Also
// hands back the raw rows so the workflow-facts builder can derive its extra
// signals without re-querying.
async function loadStageFacts(
  sb: SupabaseClient,
  row: StageEngagementRow,
): Promise<{
  facts: StageFacts;
  items: StageChecklistItem[];
  sigs: { status: string }[];
  invoice: { status: string } | null;
}> {
  const engagementId = row.id;

  const [itemsRes, sigRes, payRes, docRes] = await Promise.all([
    sb
      .from("request_items")
      .select("kind, required, status, rejection_reason")
      .eq("engagement_id", engagementId),
    sb
      .from("signature_requests")
      .select("status")
      .eq("engagement_id", engagementId),
    // 0610 allows at most one non-cancelled ENGAGEMENT invoice; 1680 added
    // deposits alongside it. Fetch the non-cancelled rows and pick the
    // engagement's own invoice below — a DEPOSIT must never stand in for it
    // (the audit's finding: the newest-row shortcut let a proposal's deposit
    // read as "the invoice", satisfying invoice_sent/invoice_paid and
    // auto-completing flows that end on invoicing). `kind` is requested
    // tolerantly: pre-1680 rows/environments have no column and every row is
    // the engagement invoice, which the filter below treats as exactly that.
    sb
      .from("payment_requests")
      .select("status, locks_deliverables, override_unlocked, kind")
      .eq("engagement_id", engagementId)
      .neq("status", "canceled")
      .order("created_at", { ascending: false }),
    sb
      .from("final_documents")
      .select("storage_path")
      .eq("engagement_id", engagementId),
  ]);

  // Each table is tolerated as absent (signature_requests pre-0400,
  // payment_requests pre-0380, final_documents pre-0620) — an unapplied
  // migration means "this engagement has none of those", which is the truth for
  // that environment.
  const items = (itemsRes.data ?? []) as StageChecklistItem[];
  const sigs = (sigRes.data ?? []) as { status: string }[];
  // Pre-1680 the kind column is missing and the select above errors — retry
  // without it rather than reading "no invoice" on an engagement that has one.
  let payRows = (payRes.data ?? []) as {
    status: "requested" | "paid" | "failed" | "canceled";
    locks_deliverables?: boolean;
    override_unlocked?: boolean;
    kind?: string | null;
  }[];
  if (payRes.error && isMissingSchema(payRes.error)) {
    const { data: legacy } = await sb
      .from("payment_requests")
      .select("status, locks_deliverables, override_unlocked")
      .eq("engagement_id", engagementId)
      .neq("status", "canceled")
      .order("created_at", { ascending: false });
    payRows = (legacy ?? []) as typeof payRows;
  }
  const invoice =
    payRows.find((r) => (r.kind ?? "engagement") !== "deposit") ?? null;
  const docs = (docRes.data ?? []) as { storage_path: string }[];

  // Invoice attachments live in final_documents under /invoices/ but are NOT
  // deliverables — mirrors listFinalDocumentsForEngagement's filter.
  const hasFinalDocuments = docs.some(
    (d) => !d.storage_path.includes("/invoices/"),
  );

  // "Released" = a deliverable exists AND the client can actually reach it. The
  // lock rule is the same one that gates /api/portal/deliverables, so the stage
  // can never claim the work is delivered while the portal is withholding it.
  const locked = computeDeliverablesLocked({
    invoice: invoice
      ? {
          locks_deliverables: invoice.locks_deliverables === true,
          status: invoice.status,
          override_unlocked: invoice.override_unlocked === true,
        }
      : null,
    engagementLocksDeliverables: row.invoice_locks_deliverables === true,
  });

  const hasSignatureItems = items.some((i) => i.kind === "signature");

  const facts: StageFacts = {
    status: row.status,
    ...checklistFacts(items),
    hasSignatureItems,
    hasSignatureRequests: sigs.length > 0,
    // A 'pending' request is a DRAFT still being prepared (accountant placing
    // fields / not yet sent), so it is NOT out with the client and must not hold
    // the engagement at "awaiting signature". Only sent/viewed count as
    // outstanding. (Finalizing a draft flips it to 'sent', which does count.)
    hasOutstandingSignature: sigs.some(
      (s) => s.status === "sent" || s.status === "viewed",
    ),
    hasInvoice: invoice != null,
    hasUnpaidInvoice:
      invoice != null &&
      (invoice.status === "requested" || invoice.status === "failed"),
    hasFinalDocuments,
    finalDocumentsReleased: hasFinalDocuments && !locked,
    preparationStarted: row.preparation_started_at != null,
  };
  return { facts, items, sigs, invoice };
}

// The workflow walk's extra signals, on top of the legacy facts. Two more
// small reads (workflow tasks + the materialization ledger), both tolerating
// an unapplied 1560 as "none", which is the truth for that environment.
async function loadWorkflowFacts(
  sb: SupabaseClient,
  row: StageEngagementRow,
  base: StageFacts,
  raws: {
    items: StageChecklistItem[];
    sigs: { status: string }[];
    invoice: { status: string } | null;
  },
): Promise<WorkflowFacts> {
  const [tasksRes, ledgerRes] = await Promise.all([
    sb
      .from("engagement_tasks")
      .select("workflow_stage, status")
      .eq("engagement_id", row.id)
      .not("workflow_stage", "is", null),
    sb
      .from("workflow_stage_events")
      .select("stage")
      .eq("engagement_id", row.id)
      .eq("action", "materialize_tasks"),
  ]);

  const stageTasksOpen: Partial<Record<EngagementStage, number>> = {};
  for (const t of (tasksRes.data ?? []) as {
    workflow_stage: string;
    status: string;
  }[]) {
    const s = t.workflow_stage as EngagementStage;
    if (t.status !== "done") {
      stageTasksOpen[s] = (stageTasksOpen[s] ?? 0) + 1;
    }
  }
  const stageTasksMaterialized: Partial<Record<EngagementStage, boolean>> = {};
  for (const e of (ledgerRes.data ?? []) as { stage: string }[]) {
    stageTasksMaterialized[e.stage as EngagementStage] = true;
  }

  // A request that is pending (a draft being placed), canceled, or errored
  // never went out; anything else (sent / viewed / completed / declined /
  // expired) did — which is what signature_request_sent asks about.
  const NOT_SENT = new Set(["pending", "canceled", "error"]);

  // ⚠️ THE ENGAGEMENT LETTER IS NOT "THE RETURN WENT OUT FOR SIGNATURE".
  //
  // The return flow sends the letter on entering COLLECTING and later leaves
  // in_preparation on `signature_request_sent`. Counting every signature
  // request would let the letter — sent days earlier, while documents were
  // still arriving — satisfy that condition the instant preparation began,
  // skipping the whole stage. The legacy resolver carries the same warning
  // about authorizations for exactly this reason.
  //
  // letter_key is non-null ONLY on an automated engagement letter (1580), so
  // excluding those rows asks the honest question. Queried separately and
  // tolerantly: on a pre-1580 database the column is absent, the query
  // errors, and we fall back to counting every request — today's behaviour,
  // and a firm without 1580 has no automated letters to confuse it with.
  let sentRows: { status: string }[] = raws.sigs;
  {
    const { data, error } = await sb
      .from("signature_requests")
      .select("status")
      .eq("engagement_id", row.id)
      .is("letter_key", null);
    if (!error) sentRows = (data ?? []) as { status: string }[];
  }

  return {
    ...base,
    gates: parseStageGates(row.stage_gates),
    signatureEverSent: sentRows.some((s) => !NOT_SENT.has(s.status)),
    completedSignatureCount: raws.sigs.filter((s) => s.status === "completed")
      .length,
    signatureItemsUnsettled: raws.items.filter(
      (i) =>
        i.kind === "signature" && i.status !== "approved" && i.status !== "na",
    ).length,
    invoicePaid: raws.invoice?.status === "paid",
    stageTasksOpen,
    stageTasksMaterialized,
  };
}

// Persist a stage + its history entry. Returns false when the columns aren't
// there yet (pre-0690) so the caller can skip the side effects too.
async function writeStage(
  sb: SupabaseClient,
  row: StageEngagementRow,
  stage: EngagementStage | null,
  triggeredBy: "auto" | string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const history = parseStageHistory(row.stage_history);
  // Only log a real transition. A null stage (draft / cancelled) clears the
  // column without an entry — there's no position to record.
  const nextHistory: StageHistoryEntry[] =
    stage != null
      ? appendStageHistory(history, { stage, at: now, triggered_by: triggeredBy })
      : history;

  const { error } = await sb
    .from("engagements")
    .update({
      stage,
      stage_updated_at: stage != null ? now : null,
      stage_history: nextHistory,
    })
    .eq("id", row.id);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[stage-sync] write stage failed:", error);
    }
    return false;
  }
  return true;
}

// The engagement reached its final stage, so the lifecycle follows: the spec
// requires stage=completed to also move the lifecycle to Completed.
//
// Deliberately mirrors completeEngagementAction's side effects rather than
// calling it (that's a "use server" action bound to a session; this also runs
// from webhooks and the portal). The invoice automation is dispatched exactly as
// a manual completion would: if the firm set "invoice on completion", it fires,
// the invoice becomes owed, and the NEXT sync honestly settles the stage back on
// awaiting_payment. That's the intended behaviour — the work IS done and the
// client now owes for it.
async function completeLifecycle(
  sb: SupabaseClient,
  row: StageEngagementRow,
): Promise<void> {
  const completedAt = new Date().toISOString();
  const { error } = await sb
    .from("engagements")
    .update({ status: "complete", completed_at: completedAt })
    .eq("id", row.id)
    // Only from a live status, so this can't resurrect a cancelled engagement
    // or re-complete an already-complete one (which would re-fire the invoice).
    .in("status", ["sent", "in_progress"]);
  if (error) {
    console.error("[stage-sync] auto-complete failed:", error);
    return;
  }
  await cancelEngagementReminders(row.id);
  // Cloud-storage filing (0900): queue the auto-file pass, mirroring
  // completeEngagementAction. Best-effort; the worker re-checks everything.
  try {
    await enqueueJob({
      kind: "file_to_storage",
      payload: { engagementId: row.id },
      runAfter: new Date(),
    });
  } catch (e) {
    console.error("[stage-sync] filing enqueue failed:", e);
  }
  await logServiceRoleActivity(row.firm_id, row.id, "complete_engagement", {
    auto: true,
    reason: "stage_completed",
  });
  // Imported dynamically to break a genuine import cycle: invoices/schedule ->
  // invoices/send -> stage-sync (send re-resolves the stage after raising its
  // invoice) -> invoices/schedule. A static import works today only because
  // every link in that cycle is a hoisted function declaration — too subtle a
  // property to leave load-bearing in the billing path. Deferring it to call
  // time makes the module graph acyclic; this is a rare path, so the cost is
  // nil.
  const { dispatchInvoiceOnCompletion } = await import("@/lib/invoices/schedule");
  // sendEngagementInvoice re-reads the engagement and only fires for a
  // still-complete one, so the status write above must land first (it has).
  await dispatchInvoiceOnCompletion({
    id: row.id,
    invoice_auto_mode: row.invoice_auto_mode,
    invoice_delay_days: row.invoice_delay_days,
    completed_at: completedAt,
  });
}

/**
 * Re-derive and persist an engagement's stage from its current contents.
 *
 * This is the single entry point for every automatic transition in the spec.
 * Call it after ANY event that could change where the engagement stands; it
 * works out whether anything actually moved and writes only if so.
 *
 * Never throws — a stage is a display convenience and must not fail the action
 * that triggered it.
 *
 * @param triggeredBy "auto" for an event-driven sync (the default), or a user id
 *   when a person's action is what re-derived it.
 * @returns the resolved stage, or null (draft / cancelled / not yet migrated).
 */
export async function syncEngagementStage(
  sb: SupabaseClient,
  engagementId: string,
  opts: { triggeredBy?: "auto" | string; _depth?: number } = {},
): Promise<EngagementStage | null> {
  try {
    const loaded = await loadEngagementRow(sb, engagementId);
    if (!loaded) return null;
    const { row, hasStageColumns } = loaded;
    if (!hasStageColumns) return null; // pre-0690: inert

    const { facts, items, sigs, invoice } = await loadStageFacts(sb, row);

    // Workflow engagements (1560) resolve by their own snapshot's walk; the
    // firm switch is a kill-switch back to legacy behaviour mid-flight.
    // Everything without a snapshot — every engagement that predates the
    // feature — takes the legacy resolver, byte-identical to before.
    let wf: WorkflowSnapshot | null =
      row.workflow != null ? parseWorkflowSnapshot(row.workflow) : null;
    if (
      wf &&
      !(await isWorkflowsEnabledForFirm(getServiceRoleSupabase(), row.firm_id))
    ) {
      wf = null;
    }
    const next = wf
      ? resolveWorkflowStage(
          wf,
          await loadWorkflowFacts(sb, row, facts, { items, sigs, invoice }),
        )
      : resolveStage(facts);

    // Unchanged: nothing to write, no history noise. This is the common case —
    // most events (a second upload on a five-item checklist) don't move a stage.
    if (next === (row.stage ?? null)) return next;

    const written = await writeStage(sb, row, next, opts.triggeredBy ?? "auto");
    if (!written) return null;

    if (next === "completed" && row.status !== "complete") {
      await completeLifecycle(sb, row);
    }

    // Fire the workflow's entry effects for the stage(s) just reached, then
    // settle once more if an effect changed the facts — send_invoice can
    // itself satisfy invoice_sent, and waiting for the next outside event
    // would leave the engagement parked one stage early. Depth-capped so a
    // misconfigured flow can never loop.
    if (wf && next != null) {
      const fx = await runWorkflowStageEffects({
        engagementId,
        firmId: row.firm_id,
        clientId: row.client_id,
        prev: row.stage ?? null,
        next,
        wf,
      });
      const depth = opts._depth ?? 0;
      if (fx.factsChanged && depth < 2) {
        const settled = await syncEngagementStage(sb, engagementId, {
          ...opts,
          _depth: depth + 1,
        });
        return settled ?? next;
      }
    }
    return next;
  } catch (e) {
    console.error("[stage-sync] sync failed:", e);
    return null;
  }
}

/**
 * The confirm-gate the engagement is currently WAITING on, if any — the
 * founder's tap. Null when there is no workflow, the firm switch is off, or
 * nothing is held. Read-only: the engagement page renders this as the
 * approval card, whose button calls approveWorkflowGateAction.
 *
 * This was the engine's missing limb (coherence audit, confirmed twice):
 * every built-in flow puts a confirm gate on in_review, the gate machinery
 * existed end to end, and no surface ever ASKED the human — so every flag-on
 * engagement parked at In review forever.
 */
export async function getPendingWorkflowGate(
  sb: SupabaseClient,
  engagementId: string,
): Promise<{ from: EngagementStage; to: EngagementStage } | null> {
  try {
    const loaded = await loadEngagementRow(sb, engagementId);
    if (!loaded?.hasStageColumns) return null;
    const { row } = loaded;
    const wf = row.workflow != null ? parseWorkflowSnapshot(row.workflow) : null;
    if (!wf) return null;
    if (
      !(await isWorkflowsEnabledForFirm(getServiceRoleSupabase(), row.firm_id))
    ) {
      return null;
    }
    const { facts, items, sigs, invoice } = await loadStageFacts(sb, row);
    const wfFacts = await loadWorkflowFacts(sb, row, facts, {
      items,
      sigs,
      invoice,
    });
    const { pendingConfirmGate } = await import("@/lib/workflow/resolve");
    return pendingConfirmGate(wf, wfFacts);
  } catch (e) {
    console.error("[stage-sync] pending gate read failed:", e);
    return null;
  }
}

/**
 * Approve a confirm-gated transition: latch the stage's gate against the
 * approving user, then re-resolve. The workflow twin of startPreparation —
 * and like that latch it is deliberately sticky: a stage that regresses on
 * facts and recovers does not re-ask for an approval already given.
 *
 * Returns false when there was nothing to latch (no workflow, draft/cancelled,
 * or the write didn't land) so the caller can tell the user.
 */
export async function latchWorkflowGate(
  sb: SupabaseClient,
  engagementId: string,
  stage: EngagementStage,
  userId: string,
): Promise<boolean> {
  try {
    const loaded = await loadEngagementRow(sb, engagementId);
    if (!loaded) return false;
    const { row } = loaded;
    if (row.status === "draft" || row.status === "cancelled") return false;
    const wf = row.workflow != null ? parseWorkflowSnapshot(row.workflow) : null;
    if (!wf) return false;

    const gates = parseStageGates(row.stage_gates);
    if (gates[stage]) {
      // Already approved — idempotent; just make sure the stage caught up.
      await syncEngagementStage(sb, engagementId, { triggeredBy: userId });
      return true;
    }
    const { error } = await sb
      .from("engagements")
      .update({
        stage_gates: {
          ...gates,
          [stage]: { by: userId, at: new Date().toISOString() },
        },
      })
      .eq("id", engagementId);
    if (error) {
      if (!isMissingSchema(error)) {
        console.error("[stage-sync] gate latch failed:", error);
      }
      return false;
    }
    await logServiceRoleActivity(row.firm_id, row.id, "workflow_gate_approved", {
      stage,
      by: userId,
    });
    await syncEngagementStage(sb, engagementId, { triggeredBy: userId });
    return true;
  } catch (e) {
    console.error("[stage-sync] gate latch failed:", e);
    return false;
  }
}

/**
 * Convenience wrapper for callers with no Supabase client of their own — the
 * SignWell webhook, the Stripe Connect webhook, and the invoice cron worker.
 * The engagement id must come from trusted server state (a verified webhook
 * payload or a job row), never from client input: the service role bypasses RLS.
 */
export async function syncEngagementStageSR(
  engagementId: string,
  opts: { triggeredBy?: "auto" | string } = {},
): Promise<EngagementStage | null> {
  return syncEngagementStage(getServiceRoleSupabase(), engagementId, opts);
}

/**
 * Manual override: a person sets the stage directly, recorded against their id.
 *
 * The override is NOT sticky. It writes the stage the accountant asked for and
 * logs who did it, but the next automatic event re-resolves from facts and may
 * move it again — per the spec, auto always reflects reality. This is a "put it
 * here for now" control, not a lock.
 *
 * Returns false when the write didn't land (pre-0690, or an RLS/DB failure), so
 * the caller can tell the user instead of silently doing nothing.
 */
export async function setEngagementStageManually(
  sb: SupabaseClient,
  engagementId: string,
  stage: EngagementStage,
  userId: string,
): Promise<boolean> {
  try {
    const loaded = await loadEngagementRow(sb, engagementId);
    if (!loaded || !loaded.hasStageColumns) return false;
    const { row } = loaded;
    // A draft or cancelled engagement has no workflow position to override.
    if (row.status === "draft" || row.status === "cancelled") return false;

    const written = await writeStage(sb, row, stage, userId);
    if (!written) return false;

    await logServiceRoleActivity(row.firm_id, row.id, "stage_changed", {
      stage,
      from: row.stage ?? null,
      manual: true,
    });
    // Honour the lifecycle rule for a manual completion too, so setting the
    // stage to Completed by hand behaves like reaching it automatically.
    if (stage === "completed" && row.status !== "complete") {
      await completeLifecycle(sb, row);
    }
    return true;
  } catch (e) {
    console.error("[stage-sync] manual set failed:", e);
    return false;
  }
}

/**
 * The "Start preparation" action: latch the accountant's declaration that they
 * are working on the file, then re-resolve. The latch is one OR arm in
 * preparationReached — it never overrides reality, so if the client still owes a
 * document the engagement stays at collecting and moves to in_preparation on its
 * own once the checklist clears.
 *
 * The latch is intentionally never cleared: it records that the firm started
 * preparing, which stays true even if a document is later reopened.
 */
export async function startPreparation(
  sb: SupabaseClient,
  engagementId: string,
  userId: string,
): Promise<boolean> {
  try {
    const { error } = await sb
      .from("engagements")
      .update({ preparation_started_at: new Date().toISOString() })
      .eq("id", engagementId)
      .is("preparation_started_at", null);
    if (error) {
      if (!isMissingSchema(error)) {
        console.error("[stage-sync] startPreparation failed:", error);
      }
      return false;
    }
    await syncEngagementStage(sb, engagementId, { triggeredBy: userId });
    return true;
  } catch (e) {
    console.error("[stage-sync] startPreparation failed:", e);
    return false;
  }
}
