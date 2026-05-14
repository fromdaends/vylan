import { getServerSupabase } from "@/lib/supabase/server";
import type { DocType } from "./templates";

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

export async function approveItem(itemId: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("request_items")
    .update({
      status: "approved",
      approved_by: auth.user?.id ?? null,
      approved_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq("id", itemId);
  if (error) throw error;
}

export async function rejectItem(
  itemId: string,
  reason: string,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("request_items")
    .update({
      status: "rejected",
      rejection_reason: reason,
      approved_by: null,
      approved_at: null,
    })
    .eq("id", itemId);
  if (error) throw error;
}

export async function reopenItem(itemId: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("request_items")
    .update({
      status: "pending",
      rejection_reason: null,
      approved_by: null,
      approved_at: null,
    })
    .eq("id", itemId);
  if (error) throw error;
}

export type NewItemInput = {
  engagement_id: string;
  label: string;
  label_fr?: string | null;
  description?: string | null;
  description_fr?: string | null;
  doc_type: DocType;
  required: boolean;
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
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RequestItem;
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
