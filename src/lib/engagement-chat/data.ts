// Engagement-scoped data fetchers for the chat's read tools. Every query runs
// on the caller's RLS session client and filters by the ONE engagement id the
// route bound at auth time — the model never supplies an id, so it cannot
// reach outside the engagement (or the firm) by construction.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReminderSettings } from "@/lib/reminder-settings";
import type { ChatFileRow } from "./search";

export type ChatItemRow = {
  id: string;
  label: string;
  label_fr: string | null;
  doc_type: string | null;
  required: boolean;
  status: "pending" | "submitted" | "approved" | "rejected" | "na";
  rejection_reason: string | null;
  kind: "collection" | "signature" | null;
  order_index: number | null;
  ai_set_assessment: {
    outcome?: string | null;
    conclusion_en?: string | null;
    conclusion_fr?: string | null;
    client_request_en?: string | null;
    client_request_fr?: string | null;
    flags?: string[] | null;
  } | null;
};

export async function fetchChatFiles(
  sb: SupabaseClient,
  engagementId: string,
): Promise<ChatFileRow[]> {
  const res = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, display_name, original_filename, ai_classification, ai_confidence, review_status, rejection_reason, reviewed_by, is_duplicate, uploaded_at, ai_extracted_fields, ai_usability",
    )
    .eq("engagement_id", engagementId)
    .order("uploaded_at", { ascending: false });
  if (res.error) throw res.error;
  return (res.data ?? []) as ChatFileRow[];
}

export async function fetchChatItems(
  sb: SupabaseClient,
  engagementId: string,
): Promise<ChatItemRow[]> {
  const res = await sb
    .from("request_items")
    .select(
      "id, label, label_fr, doc_type, required, status, rejection_reason, kind, order_index, ai_set_assessment",
    )
    .eq("engagement_id", engagementId)
    .order("order_index", { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []) as ChatItemRow[];
}

export type ChatEngagementRow = {
  id: string;
  title: string;
  type: string | null;
  status: string;
  due_date: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  reminders_paused: boolean | null;
  reminder_settings: ReminderSettings | null;
  client_id: string;
  assigned_user_id: string | null;
};

export async function fetchChatEngagement(
  sb: SupabaseClient,
  engagementId: string,
): Promise<ChatEngagementRow | null> {
  const res = await sb
    .from("engagements")
    .select(
      "id, title, type, status, due_date, sent_at, completed_at, created_at, reminders_paused, reminder_settings, client_id, assigned_user_id",
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as ChatEngagementRow) ?? null;
}

export async function fetchClientName(
  sb: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const res = await sb
    .from("clients")
    .select("display_name")
    .eq("id", clientId)
    .maybeSingle();
  if (res.error) return null;
  return (res.data as { display_name: string | null } | null)?.display_name ?? null;
}

export async function fetchUserLabel(
  sb: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const res = await sb
    .from("users")
    .select("display_name, name, email")
    .eq("id", userId)
    .maybeSingle();
  if (res.error || !res.data) return null;
  const row = res.data as {
    display_name: string | null;
    name: string | null;
    email: string | null;
  };
  return (
    row.display_name || row.name || row.email?.split("@")[0] || null
  );
}

export type ChatPaymentRow = {
  status: string;
  amount_cents: number;
  currency: string | null;
  created_at: string;
};

// Latest payment request (the one that drives the UI badge). Tolerant of the
// table being absent on old environments — payments are optional context.
export async function fetchLatestPayment(
  sb: SupabaseClient,
  engagementId: string,
): Promise<ChatPaymentRow | null> {
  const res = await sb
    .from("payment_requests")
    .select("status, amount_cents, currency, created_at")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (res.error) return null;
  return ((res.data ?? [])[0] as ChatPaymentRow) ?? null;
}

export type ChatActivityRow = {
  action: string;
  actor_type: "user" | "client" | "system";
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function fetchChatActivity(
  sb: SupabaseClient,
  engagementId: string,
  limit: number,
): Promise<ChatActivityRow[]> {
  const res = await sb
    .from("activity_log")
    .select("action, actor_type, metadata, created_at")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (res.error) throw res.error;
  return (res.data ?? []) as ChatActivityRow[];
}
