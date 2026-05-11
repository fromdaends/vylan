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
