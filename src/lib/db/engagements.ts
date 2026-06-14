import { customAlphabet } from "nanoid";
import { getServerSupabase } from "@/lib/supabase/server";
import { DELETED_RETENTION_DAYS } from "@/lib/engagements/lifecycle";
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
  reminders_paused: boolean;
  // Per-engagement AI toggle (migration 0340). When false, no document uploaded
  // to this engagement is sent to the AI. Defaults true. Optional on the type so
  // reads survive the pre-migration window (column absent → undefined → treated
  // as ON everywhere via the `=== false` checks).
  ai_enabled?: boolean;
  created_at: string;
  // Lifecycle (migration 0139). archive = hidden from active views, reversible
  // anytime; soft-delete = 30-day recoverable window before the purge cron.
  archived_at: string | null;
  archived_by_user_id: string | null;
  deleted_at: string | null;
  deleted_by_user_id: string | null;
};

export async function setRemindersPaused(
  id: string,
  paused: boolean,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ reminders_paused: paused })
    .eq("id", id);
  if (error) throw error;
}

const tokenAlphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generateMagicToken = customAlphabet(tokenAlphabet, 43);

export function newMagicToken(): string {
  return generateMagicToken();
}

// Lifecycle scope for a listing (orthogonal to `status`):
//   - "active"   (default): not archived, not deleted — the day-to-day board.
//   - "archived": manually archived, not deleted.
//   - "deleted":  soft-deleted within the 30-day window (Recently Deleted).
//   - "any":      no lifecycle filter (e.g. a single-client history view).
// Defaulting to "active" means every existing caller automatically stops
// surfacing archived / deleted engagements.
export type EngagementScope = "active" | "archived" | "deleted" | "any";

export async function listEngagements(filters?: {
  client_id?: string;
  status?: EngagementStatus | "all";
  scope?: EngagementScope;
}): Promise<Engagement[]> {
  const supabase = await getServerSupabase();
  let q = supabase.from("engagements").select("*");
  if (filters?.client_id) q = q.eq("client_id", filters.client_id);
  if (filters?.status && filters.status !== "all") {
    q = q.eq("status", filters.status);
  }
  const scope = filters?.scope ?? "active";
  if (scope === "active") {
    q = q.is("deleted_at", null).is("archived_at", null);
  } else if (scope === "archived") {
    q = q.is("deleted_at", null).not("archived_at", "is", null);
  } else if (scope === "deleted") {
    // Recently Deleted = soft-deleted within the retention window; older rows
    // are awaiting / mid-purge and must not surface.
    const cutoff = new Date(
      Date.now() - DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    q = q.not("deleted_at", "is", null).gte("deleted_at", cutoff);
  }
  // "any": no lifecycle filter at all.
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
  // "AI Analyze" switch from the engagement builder. Defaults true upstream.
  ai_enabled: boolean;
  items: TemplateItem[];
};

// A write that referenced a column the current DB doesn't have yet (a migration
// deployed in code but not applied to this environment). PostgREST reports a
// schema-cache miss (PGRST204); Postgres proper reports undefined_column (42703).
function isUnknownColumnError(
  err: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /ai_enabled/i.test(err.message ?? "")
  );
}

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

  // Base row (valid in every environment). ai_enabled (migration 0340) is added
  // separately so creation survives the deploy→migrate window: if that column
  // doesn't exist yet, including it would fail the WHOLE insert and break
  // engagement creation. Try WITH it; only on a missing-column error retry
  // WITHOUT it. Fail-open — until the migration lands the toggle has no effect
  // (AI stays on, the default), matching the read side which also defaults ON.
  const baseRow = {
    firm_id: u.firm_id,
    client_id: input.client_id,
    title: input.title,
    type: input.type,
    status: "draft",
    due_date: input.due_date,
    // Default the creator as the assignee-of-record (accountability, not
    // access control — every firm member still sees every engagement).
    assigned_user_id: user.user.id,
    assigned_at: new Date().toISOString(),
  };
  let { data: engagement, error: engErr } = await supabase
    .from("engagements")
    .insert({ ...baseRow, ai_enabled: input.ai_enabled })
    .select("*")
    .single();
  if (engErr && isUnknownColumnError(engErr)) {
    ({ data: engagement, error: engErr } = await supabase
      .from("engagements")
      .insert(baseRow)
      .select("*")
      .single());
  }
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

// --- Lifecycle mutators: archive (reversible, never purged) + soft-delete
// (30-day recoverable window). Rules + permissions live in
// src/lib/engagements/lifecycle.ts; the permanent purge runs in
// src/app/api/cron/purge-deleted-engagements. ---

export async function archiveEngagement(
  id: string,
  userId: string,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({
      archived_at: new Date().toISOString(),
      archived_by_user_id: userId,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function unarchiveEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ archived_at: null, archived_by_user_id: null })
    .eq("id", id);
  if (error) throw error;
}

// Soft-delete: recoverable for 30 days, then the purge cron removes it for
// good. OWNER-ONLY — enforced in the server action (canDeleteEngagements).
export async function softDeleteEngagement(
  id: string,
  userId: string,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: userId,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ deleted_at: null, deleted_by_user_id: null })
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

// Permanently delete an engagement of any status. RLS scopes the delete to
// the caller's firm. The FK cascade on request_items / uploaded_files /
// jobs / activity_log removes all related rows, so this can't orphan data.
// Irreversible — callers must confirm with the user first.
export async function deleteEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("engagements").delete().eq("id", id);
  if (error) throw error;
}
