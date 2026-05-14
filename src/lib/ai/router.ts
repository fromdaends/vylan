// Rejection routing for AI usability verdicts.
//
// Phase 2 (classify.ts) writes the AI's verdict to uploaded_files.ai_usability.
// Phase 3 (this file) decides what to do with it and performs the side
// effects. Phase 4 will fill in the client-retry email/SMS handler;
// Phase 5 builds the UI badges + override button.
//
// Two pieces:
//   * `decide(...)` — pure, no IO, easy to unit-test. Reads the firm
//     flag + per-item strike counter, returns one of three actions.
//   * `applyDecision(...)` — does the DB writes + activity log entry +
//     job queueing for the chosen action. Idempotency is not a goal
//     here; the worker calls this exactly once per usable=false
//     classification.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueJob } from "@/lib/db/jobs";
import type { UsabilityVerdict } from "./usability";

export type RouterDecision =
  | "auto_reject_and_notify_client"
  | "escalate_to_accountant"
  | "queue_for_accountant";

// Two strikes-and-escalate threshold. Tunable in one place if we want
// to change the policy later.
export const AUTO_REJECT_STRIKE_LIMIT = 2;

export function decide(opts: {
  autoRejectOn: boolean;
  rejectionCount: number;
}): RouterDecision {
  if (!opts.autoRejectOn) return "queue_for_accountant";
  if (opts.rejectionCount < AUTO_REJECT_STRIKE_LIMIT) {
    return "auto_reject_and_notify_client";
  }
  // Two strikes already on this item — likely the AI is being too
  // picky or the client can't get a clean shot. Either way, the
  // accountant should look at it instead of the client getting a
  // third nag. Counter intentionally NOT incremented here so the
  // override flow can decrement it back to a sensible 1.
  return "escalate_to_accountant";
}

type ClientLocale = "fr" | "en";

export type DispatcherContext = {
  // Service-role supabase client. The router runs inside the cron
  // worker, which already uses the service role to bypass RLS.
  supabase: SupabaseClient;
  decision: RouterDecision;
  verdict: UsabilityVerdict;
  fileId: string;
  requestItemId: string;
  engagementId: string;
  firmId: string;
  clientLocale: ClientLocale;
};

export type DispatcherResult = {
  decision: RouterDecision;
  jobQueued: boolean;
};

export async function applyDecision(
  ctx: DispatcherContext,
): Promise<DispatcherResult> {
  switch (ctx.decision) {
    case "auto_reject_and_notify_client":
      return autoRejectAndNotify(ctx);
    case "escalate_to_accountant":
      return escalateToAccountant(ctx);
    case "queue_for_accountant":
      return queueForAccountant(ctx);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-decision side effects
// ─────────────────────────────────────────────────────────────────────

async function autoRejectAndNotify(
  ctx: DispatcherContext,
): Promise<DispatcherResult> {
  const { supabase, verdict, fileId, requestItemId, engagementId, firmId } =
    ctx;

  // Re-open the request item so the client portal shows it as
  // outstanding again. The AI's bilingual summary becomes the
  // accountant-facing rejection reason.
  await supabase
    .from("request_items")
    .update({
      status: "pending",
      rejection_reason: pickClientLocaleSummary(verdict, ctx.clientLocale),
      // Note: the column is a free-text reason. We store the
      // client-facing summary here so the accountant sees the same
      // message the client will read. Both bilingual fields live on
      // uploaded_files.ai_usability for full audit.
    })
    .eq("id", requestItemId);

  // Bump the strike counter via a small read-modify-write. We do this
  // in two steps rather than a Postgres expression because the
  // supabase client typing for `.update({ col: sql\`col + 1\` })` is
  // awkward and read-modify is fine inside the per-file worker.
  const currentCount = await readRejectionCount(supabase, requestItemId);
  await supabase
    .from("request_items")
    .update({ ai_rejection_count: currentCount + 1 })
    .eq("id", requestItemId);

  // Mark this specific upload as rejected. The file stays in storage
  // — the accountant can still view it and override.
  await supabase
    .from("uploaded_files")
    .update({ ai_rejected: true })
    .eq("id", fileId);

  // Queue the client-retry notification. Phase 4 implements the
  // actual sending; until then the cron route absorbs unknown kinds
  // as non-fatal.
  await enqueueJob({
    kind: "notify_client_retry",
    payload: {
      uploaded_file_id: fileId,
      request_item_id: requestItemId,
      engagement_id: engagementId,
      language: ctx.clientLocale,
      primary_issue: verdict.primary_issue,
      issue_summary_fr: verdict.issue_summary_fr,
      issue_summary_en: verdict.issue_summary_en,
    },
    runAfter: new Date(),
  });

  await supabase.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "system",
    action: "ai_auto_rejected",
    metadata: {
      uploaded_file_id: fileId,
      request_item_id: requestItemId,
      primary_issue: verdict.primary_issue,
      usability_confidence: verdict.confidence,
    },
  });

  return { decision: ctx.decision, jobQueued: true };
}

async function escalateToAccountant(
  ctx: DispatcherContext,
): Promise<DispatcherResult> {
  const { supabase, verdict, fileId, requestItemId, engagementId, firmId } =
    ctx;

  // Item moves into the accountant's "ready to review" lane. We do
  // NOT increment the strike count — escalation is a system action,
  // not another client failure. Phase 5 surfaces a red badge.
  await supabase
    .from("request_items")
    .update({ status: "submitted" })
    .eq("id", requestItemId);

  await supabase
    .from("uploaded_files")
    .update({ ai_rejected: true })
    .eq("id", fileId);

  await supabase.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "system",
    action: "ai_escalated_to_accountant",
    metadata: {
      uploaded_file_id: fileId,
      request_item_id: requestItemId,
      primary_issue: verdict.primary_issue,
      usability_confidence: verdict.confidence,
    },
  });

  return { decision: ctx.decision, jobQueued: false };
}

async function queueForAccountant(
  ctx: DispatcherContext,
): Promise<DispatcherResult> {
  const { supabase, verdict, fileId, requestItemId, engagementId, firmId } =
    ctx;

  // Auto-reject is off. Surface the file with a yellow "AI flagged"
  // badge (Phase 5). The accountant decides whether to approve, send
  // the AI's suggested message, or reject manually with their own
  // wording.
  await supabase
    .from("request_items")
    .update({ status: "submitted" })
    .eq("id", requestItemId);

  // ai_rejected stays false — the system hasn't acted, only flagged.
  // ai_usability is already populated by process.ts before this runs.

  await supabase.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "system",
    action: "ai_quality_flagged",
    metadata: {
      uploaded_file_id: fileId,
      request_item_id: requestItemId,
      primary_issue: verdict.primary_issue,
      usability_confidence: verdict.confidence,
    },
  });

  return { decision: ctx.decision, jobQueued: false };
}

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────

function pickClientLocaleSummary(
  verdict: UsabilityVerdict,
  locale: ClientLocale,
): string {
  return locale === "fr"
    ? verdict.issue_summary_fr || verdict.issue_summary_en || ""
    : verdict.issue_summary_en || verdict.issue_summary_fr || "";
}

async function readRejectionCount(
  supabase: SupabaseClient,
  requestItemId: string,
): Promise<number> {
  const { data } = await supabase
    .from("request_items")
    .select("ai_rejection_count")
    .eq("id", requestItemId)
    .single();
  return ((data?.ai_rejection_count as number | null) ?? 0) as number;
}
