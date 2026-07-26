import { getServerSupabase } from "@/lib/supabase/server";
import { setAllFilesReviewForItem } from "./file-review";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
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
  // Optional per-item AI guidance (migration 0390). Free text the accountant
  // typed to steer the AI's assessment of this item's upload. Null = default.
  // Read by ai/process (per-file) + ai/set-assessment (item-level) prompts.
  ai_instructions: string | null;
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
  ai_instructions?: string | null;
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
      order_index: nextIdx,
      status: "pending",
      ai_instructions: input.ai_instructions ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;

  // A new checklist line changes the denominator the stage reads: adding a
  // document to an engagement that had reached in_review pulls it back to
  // collecting, because the client now owes something again. Hooked in the db
  // layer so both entry points are covered — the legacy addItemAction and the
  // POST /api/engagements/[id]/items route the dialog actually uses.
  await syncEngagementStage(supabase, input.engagement_id);
  return data as RequestItem;
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
//
// No stage sync here, unlike addItemToEngagement above: its only caller
// (addSignatureItemAction) creates the signature_requests row immediately after
// and syncs once at the end. Syncing here would run before that row exists, read
// "no signature out", and be corrected a moment later — two round-trips to reach
// the same answer.
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
};

export async function updateRequestItem(
  itemId: string,
  patch: RequestItemPatch,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("request_items")
    .update(patch)
    .eq("id", itemId)
    .select("engagement_id")
    .maybeSingle();
  if (error) throw error;
  // `required` is part of this patch, and it decides whether the item counts
  // toward the stage's checklist denominator at all — flipping the last
  // outstanding item to optional can move an engagement from collecting to
  // in_review on its own.
  if (data?.engagement_id) {
    await syncEngagementStage(supabase, data.engagement_id as string);
  }
}

export async function removeItem(itemId: string): Promise<void> {
  const supabase = await getServerSupabase();
  // Read the parent before the row is gone — the stage sync needs it, and after
  // the delete there's nothing left to look it up from.
  const { data: item } = await supabase
    .from("request_items")
    .select("engagement_id")
    .eq("id", itemId)
    .maybeSingle();
  // ON DELETE CASCADE on uploaded_files handles file rows; storage objects
  // are orphaned but that's acceptable for MVP (cleanup job later).
  const { error } = await supabase
    .from("request_items")
    .delete()
    .eq("id", itemId);
  if (error) throw error;
  // Removing the one item the client hadn't delivered unblocks the checklist,
  // so the engagement legitimately moves on.
  if (item?.engagement_id) {
    await syncEngagementStage(supabase, item.engagement_id as string);
  }
}
