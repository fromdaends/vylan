// Job worker for AI document classification.
//
// Payload: { uploaded_file_id: string }
// Reads the uploaded_files row, downloads the storage object, calls Claude,
// writes ai_classification / ai_confidence / ai_extracted_fields back, and
// logs an activity entry. Skips silently if the file is gone or the AI key
// is missing.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  checkRateLimit,
  AI_CLASSIFY_PER_FIRM_DAILY,
} from "@/lib/rate-limit";
import {
  classifyDocument,
  downloadStorageObject,
  isAiConfigured,
  type ClassificationResult,
} from "./classify";
import { shouldActOnUsability } from "./usability";
import { decide, applyDecision, type DispatcherResult } from "./router";

export async function processClassifyJob(
  payload: Record<string, unknown>,
  // Optional pre-downloaded bytes from the upload route. When present we
  // skip the storage roundtrip (saves ~1-3s on large PDFs). The cron path
  // never passes this — it has to fetch.
  preDownloaded?: { bytes: Buffer; mimeType: string },
): Promise<{
  skipped?: string;
  classified?: ClassificationResult;
  routed?: DispatcherResult;
}> {
  if (!isAiConfigured()) return { skipped: "ai_not_configured" };
  const fileId = String(payload.uploaded_file_id ?? "");
  if (!fileId) return { skipped: "missing_file_id" };

  const sb = getServiceRoleSupabase();
  const { data: file } = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, engagement_id, storage_path, mime_type, original_filename, request_items!inner(doc_type, engagement_id)",
    )
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { skipped: "file_not_found" };

  type Row = {
    request_items:
      | { doc_type: string; engagement_id: string }
      | { doc_type: string; engagement_id: string }[]
      | null;
  };
  const item = (file as unknown as Row).request_items;
  const expectedDocType = (Array.isArray(item) ? item[0]?.doc_type : item?.doc_type) as
    | string
    | undefined;
  if (!expectedDocType) return { skipped: "no_expected_doc_type" };

  // Cap AI spend per firm per day. We look up firm_id from the engagement
  // before downloading the file so an attacker can't burn bandwidth on
  // download either. If the firm is over its daily quota, defer the work
  // (skipped) — the next day's cron run can pick it up if still needed.
  const { data: engagementForLimit } = await sb
    .from("engagements")
    .select("firm_id")
    .eq("id", file.engagement_id)
    .single();
  if (engagementForLimit) {
    const rl = await checkRateLimit({
      key: `ai:classify:firm:${engagementForLimit.firm_id}`,
      ...AI_CLASSIFY_PER_FIRM_DAILY,
    });
    if (!rl.ok) return { skipped: "firm_daily_quota_exceeded" };
  }

  let bytes: Buffer;
  let mimeType: string;
  if (preDownloaded) {
    bytes = preDownloaded.bytes;
    mimeType = preDownloaded.mimeType || file.mime_type;
  } else {
    const dl = await downloadStorageObject(file.storage_path);
    if (!dl) return { skipped: "download_failed" };
    bytes = dl.bytes;
    mimeType = dl.mimeType || file.mime_type;
  }

  const result = await classifyDocument({
    expectedDocType: expectedDocType as never,
    fileBytes: bytes,
    mimeType,
  });
  if (!result) return { skipped: "no_classification" };

  // ai_rejected is intentionally NOT set here. Phase 3's routing logic
  // decides whether the system actually auto-rejects this upload based
  // on the firm's auto_reject_unusable_docs flag + the strike counter.
  await sb
    .from("uploaded_files")
    .update({
      ai_classification: result.document_type,
      ai_confidence: result.confidence,
      ai_extracted_fields: {
        extracted_year: result.extracted_year,
        extracted_amount_or_total: result.extracted_amount_or_total,
        looks_correct: result.looks_correct,
        issue_if_any: result.issue_if_any,
        // Phase 2: classification transparency — why, the identifying text
        // read, and an honest runner-up when the type was ambiguous.
        reasoning: result.reasoning,
        key_identifiers: result.key_identifiers,
        second_guess: result.second_guess,
      },
      ai_usability: result.usability,
    })
    .eq("id", file.id);

  // Pull the firm + client locale together so we can both log the
  // classification AND decide whether to route the AI's verdict.
  const { data: e } = await sb
    .from("engagements")
    .select("firm_id, clients!inner(locale)")
    .eq("id", file.engagement_id)
    .single();
  type EngagementRow = {
    firm_id: string;
    clients: { locale: "fr" | "en" } | { locale: "fr" | "en" }[];
  };
  const eRow = e as unknown as EngagementRow | null;
  const firmId = eRow?.firm_id ?? null;
  const clientLocale = Array.isArray(eRow?.clients)
    ? eRow?.clients[0]?.locale
    : eRow?.clients?.locale;

  if (firmId) {
    await sb.from("activity_log").insert({
      firm_id: firmId,
      engagement_id: file.engagement_id,
      actor_type: "system",
      action: "ai_classified",
      metadata: {
        uploaded_file_id: file.id,
        document_type: result.document_type,
        confidence: result.confidence,
        looks_correct: result.looks_correct,
        usable: result.usability.usable,
        usability_confidence: result.usability.confidence,
        primary_issue: result.usability.primary_issue,
      },
    });
  }

  // Route the verdict if (and only if) the AI is confidently unusable.
  // The router consults the firm flag + strike counter to decide
  // between auto-reject, escalate, and queue.
  let routed: DispatcherResult | undefined;
  if (firmId && shouldActOnUsability(result.usability)) {
    const [firmRow, itemRow] = await Promise.all([
      sb
        .from("firms")
        .select("auto_reject_unusable_docs")
        .eq("id", firmId)
        .single(),
      sb
        .from("request_items")
        .select("ai_rejection_count")
        .eq("id", file.request_item_id)
        .single(),
    ]);
    const autoRejectOn = Boolean(
      firmRow.data?.auto_reject_unusable_docs,
    );
    const rejectionCount = Number(
      itemRow.data?.ai_rejection_count ?? 0,
    );
    const decision = decide({ autoRejectOn, rejectionCount });
    routed = await applyDecision({
      supabase: sb,
      decision,
      verdict: result.usability,
      fileId: file.id,
      requestItemId: file.request_item_id,
      engagementId: file.engagement_id,
      firmId,
      clientLocale: clientLocale === "en" ? "en" : "fr",
    });
  }

  return { classified: result, routed };
}
