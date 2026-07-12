import { getServerSupabase } from "@/lib/supabase/server";
import { setAllFilesReviewForItem } from "./file-review";
import type { DocType } from "./templates";
import type { SetAssessment } from "@/lib/ai/set-assessment";

export type RequestItemStatus =
  | "pending"
  | "submitted"
  | "approved"
  | "rejected"
  | "na";

export type RequestItem = {
  id: string;
  engagement_id: string;
  label: string;
  label_fr: string | null;
  description: string | null;
  description_fr: string | null;
  doc_type: DocType;
  required: boolean;
  order_index: number;
  status: RequestItemStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  // Phase 1: counts how many times the AI has auto-rejected uploads
  // for this specific request item. Used by the Phase 3 router to
  // escalate after 2 strikes and by Phase 5's red badge.
  ai_rejection_count: number;
  // Prompt B: 'signature' flips the direction — the accountant supplies a
  // document and the client returns a signed copy. 'collection' (the default)
  // is the existing document-collection item.
  kind: "collection" | "signature";
  // Signature items only: the blank document the accountant uploaded to be
  // signed (storage path + original filename + mime). Null for collection items.
  signing_doc_path: string | null;
  signing_doc_name: string | null;
  signing_doc_mime: string | null;
  // Set-aware analysis (migration 0320): the item-level verdict over ALL of the
  // item's non-duplicate files judged together. Null until the set-assessment
  // worker has run for this item. Fetched by the select("*") in both
  // listRequestItems (accountant) and the portal item query.
  ai_set_assessment: SetAssessment | null;
  // Per-item custom rules for the document checker (migration 0580). Free text
  // the accountant writes ("must show 2025 and the client's SIN", "reject if
  // the total is blurred"); the checker prompt includes it so the accept /
  // reject / flag verdict for uploads against THIS item follows the rules.
  // Optional: absent (undefined) until 0580 is applied — the select("*") that
  // hydrates this simply won't carry the column. Readers default it to null.
  ai_rules?: string | null;
  created_at: string;
};

export async function listRequestItems(
  engagement_id: string,
): Promise<RequestItem[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("request_items")
    .select("*")
    .eq("engagement_id", engagement_id)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RequestItem[];
}

// Per-file model: the item-level approve/reject/reopen fan their verdict out to
// EVERY file under the item (siblings move together, as before), then the item
// status is re-derived from those files by recomputeItemStatus — so the item
// summary stays a true roll-up no matter which path made the decision.
export async function approveItem(itemId: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  await setAllFilesReviewForItem(
    supabase,
    itemId,
    "approved",
    null,
    auth.user?.id ?? null,
  );
}

export async function rejectItem(
  itemId: string,
  reason: string,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  await setAllFilesReviewForItem(
    supabase,
    itemId,
    "rejected",
    reason,
    auth.user?.id ?? null,
  );
}

export async function reopenItem(itemId: string): Promise<void> {
  const supabase = await getServerSupabase();
  await setAllFilesReviewForItem(supabase, itemId, "pending", null, null);
}

export type NewItemInput = {
  engagement_id: string;
  label: string;
  label_fr?: string | null;
  description?: string | null;
  description_fr?: string | null;
  doc_type: DocType;
  required: boolean;
  ai_rules?: string | null;
};

export async function addItemToEngagement(
  input: NewItemInput,
): Promise<RequestItem> {
  const supabase = await getServerSupabase();
  // Compute next order_index.
  const { data: last } = await supabase
    .from("request_items")
    .select("order_index")
    .eq("engagement_id", input.engagement_id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIdx = (last?.order_index ?? -1) + 1;

  const rules = normalizeAiRules(input.ai_rules);
  const { data, error } = await supabase
    .from("request_items")
    .insert({
      engagement_id: input.engagement_id,
      label: input.label,
      label_fr: input.label_fr ?? null,
      description: input.description ?? null,
      description_fr: input.description_fr ?? null,
      doc_type: input.doc_type,
      required: input.required,
      // Only send ai_rules when there ARE rules: this keeps adding a plain
      // item working before migration 0580 is applied (the column doesn't
      // exist yet, and PostgREST errors on an unknown column). The rules
      // feature itself only works once the migration lands, which is fine.
      ...(rules !== null ? { ai_rules: rules } : {}),
      order_index: nextIdx,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RequestItem;
}

// Blank / whitespace-only rules are stored as NULL so "no rules" is a single
// canonical value (the checker treats null and "" identically anyway).
export function normalizeAiRules(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type NewSignatureItemInput = {
  engagement_id: string;
  label: string;
  label_fr?: string | null;
  signing_doc_path: string;
  signing_doc_name: string;
  signing_doc_mime: string;
};

// Create a SIGNATURE item: the accountant supplies a document and the client
// returns a signed copy. Mirrors addItemToEngagement but marks kind='signature'
// and stores where the blank document lives. doc_type is the neutral 'other'
// (the column is NOT NULL and a signature isn't an AI-classified document type).
export async function addSignatureItemToEngagement(
  input: NewSignatureItemInput,
): Promise<RequestItem> {
  const supabase = await getServerSupabase();
  const { data: last } = await supabase
    .from("request_items")
    .select("order_index")
    .eq("engagement_id", input.engagement_id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIdx = (last?.order_index ?? -1) + 1;

  const { data, error } = await supabase
    .from("request_items")
    .insert({
      engagement_id: input.engagement_id,
      kind: "signature",
      label: input.label,
      label_fr: input.label_fr ?? null,
      doc_type: "other",
      required: true,
      order_index: nextIdx,
      status: "pending",
      signing_doc_path: input.signing_doc_path,
      signing_doc_name: input.signing_doc_name,
      signing_doc_mime: input.signing_doc_mime,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RequestItem;
}

// Edit an existing item's label / type / required flag (Assistant panel
// phase 3 — the first surface that can change an item after creation).
// Status and kind are deliberately NOT editable here: status is a derived
// roll-up owned by recomputeItemStatus, and signature items are owned by the
// signature flow.
export type RequestItemPatch = {
  label?: string;
  label_fr?: string | null;
  doc_type?: DocType;
  required?: boolean;
  ai_rules?: string | null;
};

export async function updateRequestItem(
  itemId: string,
  patch: RequestItemPatch,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("request_items")
    .update(patch)
    .eq("id", itemId);
  if (error) throw error;
}

export async function removeItem(itemId: string): Promise<void> {
  const supabase = await getServerSupabase();
  // ON DELETE CASCADE on uploaded_files handles file rows; storage objects
  // are orphaned but that's acceptable for MVP (cleanup job later).
  const { error } = await supabase
    .from("request_items")
    .delete()
    .eq("id", itemId);
  if (error) throw error;
}
