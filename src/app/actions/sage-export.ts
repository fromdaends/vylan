"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { getEngagement } from "@/lib/db/engagements";
import {
  buildSagePreview,
  type SageDocInput,
  type SagePreview,
} from "@/lib/integrations/sage-export";

// Preview what a Sage CSV export of ONE engagement would contain, before any
// file is made. Read-only.
//
// RLS: getEngagement + the uploaded_files read both go through the AUTHENTICATED
// client, so an engagement that isn't this firm's returns null / no rows — a
// firm can only ever preview its own engagements. Returns null when the
// engagement is not found or not visible to the caller.
export async function getSageEngagementPreview(
  engagementId: string,
): Promise<SagePreview | null> {
  if (!engagementId) return null;

  // Firm-scope gate: null for an engagement the caller can't see.
  const engagement = await getEngagement(engagementId);
  if (!engagement) return null;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("uploaded_files")
    .select(
      "id, original_filename, display_name, ai_classification, ai_extracted_fields, is_duplicate, ai_rejected, review_status, request_items!inner(doc_type)",
    )
    .eq("engagement_id", engagementId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;

  type Row = {
    id: string;
    original_filename: string | null;
    display_name: string | null;
    ai_classification: string | null;
    ai_extracted_fields: Record<string, unknown> | null;
    is_duplicate: boolean | null;
    ai_rejected: boolean | null;
    review_status: string | null;
    request_items:
      | { doc_type: string | null }
      | { doc_type: string | null }[]
      | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  const inputs: SageDocInput[] = rows
    // Never count a document that isn't really "there": an exact-duplicate
    // re-upload, an AI auto-reject, or a file the accountant rejected.
    .filter((r) => !r.is_duplicate && !r.ai_rejected && r.review_status !== "rejected")
    .map((r) => {
      const item = Array.isArray(r.request_items)
        ? r.request_items[0]
        : r.request_items;
      const txn = (r.ai_extracted_fields?.transaction ?? null) as {
        confidence?: number;
      } | null;
      return {
        id: r.id,
        name: r.display_name ?? r.original_filename ?? "Document",
        expectedDocType: item?.doc_type ?? null,
        detectedType: r.ai_classification,
        hasTransaction: txn != null,
        transactionConfidence:
          typeof txn?.confidence === "number" ? txn.confidence : null,
      };
    });

  return buildSagePreview(inputs);
}
