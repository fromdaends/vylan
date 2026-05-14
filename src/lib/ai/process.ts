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

export async function processClassifyJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; classified?: ClassificationResult }> {
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

  const dl = await downloadStorageObject(file.storage_path);
  if (!dl) return { skipped: "download_failed" };

  const result = await classifyDocument({
    expectedDocType: expectedDocType as never,
    fileBytes: dl.bytes,
    mimeType: dl.mimeType || file.mime_type,
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
      },
      ai_usability: result.usability,
    })
    .eq("id", file.id);

  const { data: e } = await sb
    .from("engagements")
    .select("firm_id")
    .eq("id", file.engagement_id)
    .single();
  if (e) {
    await sb.from("activity_log").insert({
      firm_id: e.firm_id,
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

  return { classified: result };
}
