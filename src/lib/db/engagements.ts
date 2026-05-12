import { customAlphabet } from "nanoid";
import { getServerSupabase } from "@/lib/supabase/server";
import type { EngagementType, TemplateItem } from "./templates";

export type EngagementStatus =
  | "draft"
  | "sent"
  | "in_progress"
  | "complete"
  | "cancelled";

export type Engagement = {
  id: string;
  firm_id: string;
  client_id: string;
  title: string;
  type: EngagementType;
  status: EngagementStatus;
  due_date: string | null;
  sent_at: string | null;
  completed_at: string | null;
  magic_token: string | null;
  magic_expires_at: string | null;
  assigned_user_id: string | null;
  created_at: string;
};

const tokenAlphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generateMagicToken = customAlphabet(tokenAlphabet, 43);

export function newMagicToken(): string {
  return generateMagicToken();
}

export async function listEngagements(filters?: {
  client_id?: string;
  status?: EngagementStatus | "all";
}): Promise<Engagement[]> {
  const supabase = await getServerSupabase();
  let q = supabase.from("engagements").select("*");
  if (filters?.client_id) q = q.eq("client_id", filters.client_id);
  if (filters?.status && filters.status !== "all") {
    q = q.eq("status", filters.status);
  }
  q = q.order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Engagement[];
}

export async function getEngagement(id: string): Promise<Engagement | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Engagement) ?? null;
}

export type CreateEngagementInput = {
  client_id: string;
  title: string;
  type: EngagementType;
  due_date: string | null;
  items: TemplateItem[];
};

export async function createEngagementWithItems(
  input: CreateEngagementInput,
): Promise<Engagement> {
  const supabase = await getServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not authenticated");
  const { data: u } = await supabase
    .from("users")
    .select("firm_id")
    .eq("id", user.user.id)
    .single();
  if (!u?.firm_id) throw new Error("No firm for user");

  const { data: engagement, error: engErr } = await supabase
    .from("engagements")
    .insert({
      firm_id: u.firm_id,
      client_id: input.client_id,
      title: input.title,
      type: input.type,
      status: "draft",
      due_date: input.due_date,
      assigned_user_id: user.user.id,
    })
    .select("*")
    .single();
  if (engErr || !engagement) throw engErr ?? new Error("create_failed");

  if (input.items.length > 0) {
    const rows = input.items.map((item, idx) => ({
      engagement_id: engagement.id,
      label: item.label_en,
      label_fr: item.label_fr,
      description: item.description_en ?? null,
      description_fr: item.description_fr ?? null,
      doc_type: item.doc_type,
      required: item.required,
      order_index: idx,
    }));
    const { error: itemsErr } = await supabase
      .from("request_items")
      .insert(rows);
    if (itemsErr) throw itemsErr;
  }
  return engagement as Engagement;
}

export async function sendEngagement(id: string): Promise<Engagement> {
  const supabase = await getServerSupabase();
  const token = newMagicToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  const { data, error } = await supabase
    .from("engagements")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      magic_token: token,
      magic_expires_at: expiresAt.toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Engagement;
}

export async function cancelEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw error;
}

export async function completeEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function reopenEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteDraftEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .delete()
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw error;
}
