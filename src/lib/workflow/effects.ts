// Stage-entry effects — what the workflow DOES when an engagement reaches a
// stage: hand the work to the stage's person, send the invoice, create the
// stage's tasks, notify. Called by stage-sync.ts after it persists a stage
// change on a workflow engagement; never from anywhere else.
//
// EXACTLY-ONCE, enforced by the database: every stage entry and every action
// first claims its row in workflow_stage_events (UNIQUE(engagement_id, stage,
// action)). A concurrent sync, a webhook replay, or a stage that regresses and
// recovers hits a duplicate-key error on the claim and fires nothing. Claims
// are taken BEFORE acting, so a crash mid-action burns the claim (at-most-once)
// — the spawn-ledger rule: a missed automated send is visible and recoverable
// by hand; a doubled one to a client is not. Failures update the claimed row
// to status='failed' so the engagement page can show what needs a human.
//
// SERVICE ROLE throughout: effects also fire from webhook and portal paths
// where no accountant session exists. Engagement ids here come from stage-sync
// (trusted server state), never from client input.
//
// FAIL-SOFT: like stage-sync, nothing here may ever fail the user action that
// triggered the sync. Every effect catches and logs its own errors.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { logServiceRoleActivity } from "@/lib/db/activity";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";
import { notify } from "@/lib/notifications/notify";
import { clientName } from "@/lib/notifications/emit";
import { ASSIGNMENT_EMAIL_DELAY_MS } from "@/lib/team/assignment-notify";
import {
  ENGAGEMENT_STAGES,
  type EngagementStage,
} from "@/lib/engagements/stage";
import {
  parseWorkflowSnapshot,
  workflowStageOrder,
  type WorkflowSnapshot,
  type WorkflowTaskDef,
} from "./definition";
import { flowSendsLetter } from "./plan";
import { isWorkflowsEnabledForFirm } from "./flags";

type ClaimResult = "claimed" | "duplicate" | "error";

// The ledger's stage key is text: real stages, plus 'sent' — the pseudo-phase
// for effects that belong to SENDING the engagement rather than to any stage
// (the engagement letter, per the founder: signing it IS the acceptance, so
// it cannot wait for the acceptance it produces).
type LedgerPhase = EngagementStage | "sent";

async function claimEvent(
  sb: SupabaseClient,
  row: {
    firm_id: string;
    engagement_id: string;
    stage: LedgerPhase;
    action: string;
    status?: "done" | "failed" | "skipped";
    detail?: Record<string, unknown>;
  },
): Promise<ClaimResult> {
  const { error } = await sb.from("workflow_stage_events").insert({
    firm_id: row.firm_id,
    engagement_id: row.engagement_id,
    stage: row.stage,
    action: row.action,
    status: row.status ?? "done",
    detail: row.detail ?? {},
  });
  if (!error) return "claimed";
  // 23505 = unique_violation: this entry/action already fired once. The whole
  // idempotency design funnels through this one code.
  if (error.code === "23505") return "duplicate";
  console.error("[workflow] ledger claim failed:", row.action, error);
  return "error";
}

async function markEvent(
  sb: SupabaseClient,
  where: { engagement_id: string; stage: LedgerPhase; action: string },
  patch: { status: "done" | "failed" | "skipped"; detail?: Record<string, unknown> },
): Promise<void> {
  const { error } = await sb
    .from("workflow_stage_events")
    .update({ status: patch.status, ...(patch.detail ? { detail: patch.detail } : {}) })
    .eq("engagement_id", where.engagement_id)
    .eq("stage", where.stage)
    .eq("action", where.action);
  if (error) console.error("[workflow] ledger update failed:", error);
}

type EffectsInput = {
  engagementId: string;
  firmId: string;
  clientId: string;
  // The stage column before this sync wrote (null = first position).
  prev: EngagementStage | null;
  // The stage just written.
  next: EngagementStage;
  wf: WorkflowSnapshot;
};

export type EffectsOutcome = {
  // True when an effect changed the facts the resolver reads (an invoice now
  // exists, tasks were materialized) — the caller re-syncs once so conditions
  // like invoice_sent settle without waiting for the next outside event.
  factsChanged: boolean;
};

/**
 * Fire entry effects for every stage up to and including `next` that has never
 * fired before. Computing from the ledger rather than from `prev` makes this
 * direction-agnostic and replay-proof: a regressed-and-recovered stage finds
 * its claims already taken and does nothing.
 */
export async function runWorkflowStageEffects(
  input: EffectsInput,
): Promise<EffectsOutcome> {
  const outcome: EffectsOutcome = { factsChanged: false };
  try {
    const sb = getServiceRoleSupabase();
    const order = workflowStageOrder(input.wf);
    const nextIdx = order.indexOf(input.next);
    if (nextIdx === -1) return outcome; // parked on a skipped stage by override

    const toEnter = order.slice(0, nextIdx + 1);

    // The skip-jump audit (spec: one event records the jump): stages the
    // canonical progression has between prev and next that this workflow
    // skips. Attached to the landing stage's activity entry below.
    const prevCanon = input.prev ? ENGAGEMENT_STAGES.indexOf(input.prev) : -1;
    const nextCanon = ENGAGEMENT_STAGES.indexOf(input.next);
    const skippedOver = ENGAGEMENT_STAGES.filter(
      (s, i) =>
        i > prevCanon &&
        i <= nextCanon &&
        input.wf.stages[s].skipped &&
        !order.includes(s),
    );

    for (const stage of toEnter) {
      const entered = await claimEvent(sb, {
        firm_id: input.firmId,
        engagement_id: input.engagementId,
        stage,
        action: "entered",
        detail: { from: input.prev },
      });
      if (entered !== "claimed") continue;

      const actionsRun: string[] = [];
      const stageDef = input.wf.stages[stage];
      const assigneeId = input.wf.assignees[stage] ?? null;
      let assignedNow: string | null = null;

      // ── Hand the work to the stage's person ──────────────────────────────
      if (assigneeId) {
        const claim = await claimEvent(sb, {
          firm_id: input.firmId,
          engagement_id: input.engagementId,
          stage,
          action: "assign",
          detail: { user_id: assigneeId },
        });
        if (claim === "claimed") {
          assignedNow = await applyStageAssignee(sb, input, stage, assigneeId);
          if (!assignedNow) {
            await markEvent(
              sb,
              { engagement_id: input.engagementId, stage, action: "assign" },
              { status: "skipped", detail: { reason: "not_active_member" } },
            );
          } else {
            actionsRun.push("assign");
          }
        }
      }

      // ── Entry actions, in the template's order ───────────────────────────
      for (const action of stageDef.on_entry) {
        // The letter is NOT a stage action (founder's correction): it goes
        // out when the engagement is SENT — signing it is how the client
        // accepts, so it cannot wait for the acceptance it produces.
        // runWorkflowSendEffects owns it under the 'sent' ledger key; flows
        // that still list it on a stage (the seeds, older copies) are read
        // as "this flow sends the letter" and skipped here without a claim —
        // a ledger row saying a stage sent it would be a lie.
        if (action === "send_engagement_letter") continue;
        const claim = await claimEvent(sb, {
          firm_id: input.firmId,
          engagement_id: input.engagementId,
          stage,
          action,
        });
        if (claim !== "claimed") continue;

        if (action === "activate_checklist") {
          // The portal link + reminder schedule went live when the engagement
          // was sent — the only path that reaches `collecting`. Recorded so
          // the engagement page can show the checklist automation as part of
          // this workflow rather than implying it never ran.
          await markEvent(
            sb,
            { engagement_id: input.engagementId, stage, action },
            { status: "done", detail: { via: "engagement_send" } },
          );
          actionsRun.push(action);
        } else if (action === "send_invoice") {
          // Dynamic import breaks a real cycle: invoices/send re-syncs the
          // stage after raising its invoice (send → stage-sync → effects).
          const { sendEngagementInvoice } = await import("@/lib/invoices/send");
          try {
            const res = await sendEngagementInvoice(input.engagementId, {
              atStage: true,
            });
            if (res.ok) {
              outcome.factsChanged = true;
              actionsRun.push(action);
            } else {
              await markEvent(
                sb,
                { engagement_id: input.engagementId, stage, action },
                {
                  // already_sent = a human (or invoice automation) beat us to
                  // it; the bill exists, which is the outcome we wanted.
                  status: res.reason === "already_sent" ? "skipped" : "failed",
                  detail: { reason: res.reason },
                },
              );
              if (res.reason === "already_sent") actionsRun.push(action);
            }
          } catch (e) {
            console.error("[workflow] send_invoice failed:", e);
            await markEvent(
              sb,
              { engagement_id: input.engagementId, stage, action },
              { status: "failed", detail: { reason: "exception" } },
            );
          }
        } else if (action === "notify_assignee") {
          // The reassignment above already pinged whoever just got the work;
          // this action covers stages that notify without changing hands.
          if (!assignedNow && assigneeId) {
            await notifyStageAssignee(sb, input, stage, assigneeId);
          }
          actionsRun.push(action);
        }
      }

      // ── Materialize the stage's tasks ─────────────────────────────────────
      if (stageDef.tasks.length > 0) {
        const claim = await claimEvent(sb, {
          firm_id: input.firmId,
          engagement_id: input.engagementId,
          stage,
          action: "materialize_tasks",
          detail: { count: stageDef.tasks.length },
        });
        if (claim === "claimed") {
          const created = await materializeStageTasks(
            sb,
            input,
            stage,
            stageDef.tasks,
            assigneeId,
          );
          if (created > 0) {
            outcome.factsChanged = true;
            actionsRun.push("tasks");
          } else {
            await markEvent(
              sb,
              {
                engagement_id: input.engagementId,
                stage,
                action: "materialize_tasks",
              },
              { status: "failed", detail: { reason: "insert_failed" } },
            );
          }
        }
      }

      // One audit entry per stage entered; the landing stage carries the
      // skip-jump record. Feeds both the activity trail and the "what Vylan
      // did automatically" list.
      await logServiceRoleActivity(
        input.firmId,
        input.engagementId,
        "workflow_stage_entered",
        {
          stage,
          auto: true,
          ...(actionsRun.length > 0 ? { actions: actionsRun } : {}),
          ...(stage === input.next && skippedOver.length > 0
            ? { skipped: skippedOver }
            : {}),
        },
      );
    }
  } catch (e) {
    console.error("[workflow] effects failed:", e);
  }
  return outcome;
}

/**
 * Effects that belong to SENDING, not to any stage — today exactly one: the
 * engagement letter. Founder's correction after seeing the first plan: "the
 * engagement letter is supposed to be sent upon create, not when the client
 * accepts" — signing it IS how the client agrees (signwell/complete.ts
 * records accepted_at when a letter-keyed request completes), so it must be
 * in their hands the moment the engagement is.
 *
 * Ledger key ('sent', 'send_engagement_letter'): exactly-once across every
 * send path — create-and-send, the detail page's Send button, and recurring
 * spawns all call this; only the first claim fires.
 */
export async function runWorkflowSendEffects(input: {
  engagementId: string;
  firmId: string;
}): Promise<void> {
  try {
    const sb = getServiceRoleSupabase();
    const { data } = await sb
      .from("engagements")
      .select("workflow")
      .eq("id", input.engagementId)
      .maybeSingle();
    const wf = parseWorkflowSnapshot(
      (data as { workflow?: unknown } | null)?.workflow,
    );
    if (!wf || !flowSendsLetter(wf)) return;
    if (!(await isWorkflowsEnabledForFirm(sb, input.firmId))) return;

    const claim = await claimEvent(sb, {
      firm_id: input.firmId,
      engagement_id: input.engagementId,
      stage: "sent",
      action: "send_engagement_letter",
    });
    if (claim !== "claimed") return;

    const { sendEngagementLetter } = await import("./letter");
    const res = await sendEngagementLetter(input);
    if (!res.ok) {
      await markEvent(
        sb,
        {
          engagement_id: input.engagementId,
          stage: "sent",
          action: "send_engagement_letter",
        },
        {
          // The guard doing its job (already signed/sent) and setup facts
          // (no letter, no service) are skips; everything else needs a human
          // and reads as failed on the ledger.
          status:
            res.reason === "already_signed" ||
            res.reason === "already_sent" ||
            res.reason === "not_configured" ||
            res.reason === "no_service"
              ? "skipped"
              : "failed",
          detail: {
            reason: res.reason,
            ...(res.detail ? { detail: res.detail } : {}),
          },
        },
      );
    }
  } catch (e) {
    console.error("[workflow] send effects failed:", e);
  }
}

// Reassign the engagement to the stage's person. Returns the user id when the
// row actually changed hands, null otherwise (already theirs / not an active
// member / write failed).
async function applyStageAssignee(
  sb: SupabaseClient,
  input: EffectsInput,
  stage: EngagementStage,
  assigneeId: string,
): Promise<string | null> {
  const { data: target } = await sb
    .from("users")
    .select("id, firm_id, deactivated_at")
    .eq("id", assigneeId)
    .maybeSingle();
  const t = target as {
    id: string;
    firm_id: string | null;
    deactivated_at: string | null;
  } | null;
  // Snapshot assignees were resolved at creation; people leave firms. An
  // inactive target quietly keeps the current assignee — accountability is
  // better slightly stale than pointing at somebody who is gone.
  if (!t || t.firm_id !== input.firmId || t.deactivated_at) return null;

  const { data: current } = await sb
    .from("engagements")
    .select("assigned_user_id")
    .eq("id", input.engagementId)
    .maybeSingle();
  const already =
    (current as { assigned_user_id: string | null } | null)
      ?.assigned_user_id === assigneeId;
  if (already) return null;

  const { error } = await sb
    .from("engagements")
    .update({
      assigned_user_id: assigneeId,
      assigned_at: new Date().toISOString(),
    })
    .eq("id", input.engagementId);
  if (error) {
    console.error("[workflow] stage reassign failed:", error);
    return null;
  }

  // 1540: an assignee implies access, so mirror the manual path by also
  // putting the person in the assignee set (the column above stays the
  // "who is answerable" pointer). Best-effort — pre-1540 environments and
  // hiccups keep the primary assignment, which is what accountability reads.
  try {
    const { addEngagementAssignee } = await import(
      "@/lib/db/engagement-assignees"
    );
    await addEngagementAssignee({
      engagementId: input.engagementId,
      userId: assigneeId,
      firmId: input.firmId,
      actorId: null,
    });
  } catch {
    // Unsupported (pre-1540) or transient — the primary write already landed.
  }

  await logServiceRoleActivity(
    input.firmId,
    input.engagementId,
    "workflow_stage_assigned",
    { stage, to_user_id: assigneeId, auto: true },
  );
  await notifyStageAssignee(sb, input, stage, assigneeId);
  return assigneeId;
}

// Mirror of the manual-reassign notification pair (actions/engagements.ts):
// instant in-app ping with the email suppressed, plus the delayed catch-up
// email job that skips anyone who has been active since. actorId null — this
// is Vylan acting, not a person, so nobody is exempted as "the actor".
async function notifyStageAssignee(
  sb: SupabaseClient,
  input: EffectsInput,
  stage: EngagementStage,
  assigneeId: string,
): Promise<void> {
  try {
    const { data: engRow } = await sb
      .from("engagements")
      .select("title, client_id")
      .eq("id", input.engagementId)
      .maybeSingle();
    const eng = engRow as { title: string; client_id: string } | null;
    await notify({
      firmId: input.firmId,
      eventKey: "engagement.assigned_to_you",
      entity: { type: "engagement", id: input.engagementId },
      actorId: null,
      engagementId: input.engagementId,
      clientId: eng?.client_id ?? input.clientId,
      recipients: [assigneeId],
      suppressEmail: true,
      payload: {
        engagement_title: eng?.title ?? null,
        client_name: await clientName(sb, eng?.client_id ?? input.clientId),
        actor_name: null,
        note: null,
        href: `/engagements/${input.engagementId}`,
      },
    });
  } catch (e) {
    console.error("[workflow] assignee notify failed:", e);
  }

  try {
    const { data: firmRow } = await sb
      .from("firms")
      .select("notify_on_assignment")
      .eq("id", input.firmId)
      .maybeSingle();
    const emailsOn =
      (firmRow as { notify_on_assignment?: boolean } | null)
        ?.notify_on_assignment !== false;
    if (!emailsOn) return;
    await cancelPendingJobs(
      "notify_assignment",
      (p) => p.engagement_id === input.engagementId,
    );
    await enqueueJob({
      kind: "notify_assignment",
      payload: {
        engagement_id: input.engagementId,
        assignee_id: assigneeId,
        assigned_at: new Date().toISOString(),
      },
      runAfter: new Date(Date.now() + ASSIGNMENT_EMAIL_DELAY_MS),
    });
  } catch (e) {
    console.error("[workflow] assignment email enqueue failed:", e);
  }
}

// Create the stage's tasks as ordinary engagement_tasks rows (TASKS ARE ONE
// LIST — they surface in Work, the client's Tasks card and the engagement with
// zero extra wiring). Tagged with workflow_stage so stage_tasks_done can count
// them. Returns how many rows landed.
async function materializeStageTasks(
  sb: SupabaseClient,
  input: EffectsInput,
  stage: EngagementStage,
  tasks: WorkflowTaskDef[],
  stageAssigneeId: string | null,
): Promise<number> {
  try {
    // The engagement runs in the client's language; its internal to-dos read
    // in the same one (a template title exists in both). Null locale = fr,
    // the app's original default.
    const { data: clientRow } = await sb
      .from("clients")
      .select("locale")
      .eq("id", input.clientId)
      .maybeSingle();
    const locale =
      (clientRow as { locale: string | null } | null)?.locale === "en"
        ? "en"
        : "fr";

    // Append below whatever the engagement already has.
    const { data: maxRow } = await sb
      .from("engagement_tasks")
      .select("order_index")
      .eq("engagement_id", input.engagementId)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const base =
      ((maxRow as { order_index: number } | null)?.order_index ?? -1) + 1;

    const rows = tasks.map((t, i) => ({
      client_id: input.clientId,
      engagement_id: input.engagementId,
      firm_id: input.firmId,
      title: locale === "en" ? t.title_en : t.title_fr,
      kind: "task",
      order_index: base + i,
      workflow_stage: stage,
    }));
    const { data, error } = await sb
      .from("engagement_tasks")
      .insert(rows)
      .select("id");
    if (error) {
      console.error("[workflow] task materialization failed:", error);
      return 0;
    }
    const ids = (data ?? []) as { id: string }[];

    // Per-task assignee: a named person when the template names one, else the
    // stage's person. (Task-level owner/staff rules resolve to the stage
    // assignee in v1 — the snapshot stores per-stage resolutions only.)
    const joins: { task_id: string; user_id: string; firm_id: string }[] = [];
    ids.forEach((row, i) => {
      const rule = tasks[i]?.assignee;
      const uid =
        rule && typeof rule === "object" ? rule.member_id : stageAssigneeId;
      if (uid) {
        joins.push({ task_id: row.id, user_id: uid, firm_id: input.firmId });
      }
    });
    if (joins.length > 0) {
      const { error: joinErr } = await sb
        .from("engagement_task_assignees")
        .insert(joins);
      if (joinErr) {
        // Same rule as createTask: a task with nobody on it is one click from
        // fixed; a task that failed to exist is not.
        console.error("[workflow] task assignee insert failed:", joinErr);
      }
    }

    await logServiceRoleActivity(
      input.firmId,
      input.engagementId,
      "workflow_tasks_created",
      { stage, count: ids.length, auto: true },
    );
    return ids.length;
  } catch (e) {
    console.error("[workflow] task materialization failed:", e);
    return 0;
  }
}
