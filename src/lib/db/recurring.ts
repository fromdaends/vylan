// Data layer for recurring engagement series (migration 0770). All functions
// here are RLS-scoped (the accountant's session client) — the Phase 2 spawner
// gets its own service-role core in src/lib/recurring/.
//
// GATED: every read degrades gracefully when 0770 hasn't been applied to this
// environment (missing-schema detection, the repo's 0450+/0650 pattern) — the
// engagement page must render, with Repeat simply absent, ahead of the SQL.

import { getServerSupabase } from "@/lib/supabase/server";
import type { TemplateItem, EngagementType } from "@/lib/db/templates";
import type { ReminderSettings } from "@/lib/reminder-settings";
import type {
  RecurringFrequency,
  RecurringSeriesStatus,
} from "@/lib/recurring/schedule";

export type RecurringSeries = {
  id: string;
  firm_id: string;
  client_id: string;
  source_engagement_id: string | null;
  title: string;
  type: EngagementType;
  frequency: RecurringFrequency;
  anchor_day: number;
  due_offset_days: number;
  items: TemplateItem[];
  ai_enabled: boolean;
  reminder_settings: ReminderSettings | null;
  invoice_recreate: boolean;
  invoice_snapshot: Record<string, unknown> | null;
  status: RecurringSeriesStatus;
  next_spawn_on: string; // ISO date (firm-local calendar date)
  paused_at: string | null;
  ended_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

// PostgREST/Postgres: the table/column doesn't exist yet (migration deployed
// in code but not applied here). Treated as "feature not activated".
function isMissingSchema(err: { code?: string } | null): boolean {
  const code = err?.code;
  return (
    code === "PGRST205" ||
    code === "PGRST204" ||
    code === "42P01" ||
    code === "42703"
  );
}

export async function getRecurringSeries(
  id: string,
): Promise<RecurringSeries | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("recurring_series")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  return (data as RecurringSeries) ?? null;
}

export type CreateRecurringSeriesInput = {
  firm_id: string;
  client_id: string;
  source_engagement_id: string | null;
  title: string;
  type: EngagementType;
  frequency: RecurringFrequency;
  anchor_day: number;
  due_offset_days: number;
  items: TemplateItem[];
  ai_enabled: boolean;
  reminder_settings: ReminderSettings | null;
  next_spawn_on: string;
  created_by_user_id: string | null;
};

export async function createRecurringSeries(
  input: CreateRecurringSeriesInput,
): Promise<RecurringSeries> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("recurring_series")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as RecurringSeries;
}

// Edit-future: schedule/settings changes touch ONLY the series row — every
// existing engagement is an independent copy, so this structurally cannot
// reach them. Reactivation (paused/ended -> active) rides through `status`.
export async function updateRecurringSeries(
  id: string,
  patch: Partial<
    Pick<
      RecurringSeries,
      | "frequency"
      | "anchor_day"
      | "due_offset_days"
      | "items"
      | "ai_enabled"
      | "reminder_settings"
      | "status"
      | "next_spawn_on"
      | "paused_at"
      | "ended_at"
    >
  >,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("recurring_series")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function endRecurringSeries(id: string): Promise<void> {
  await updateRecurringSeries(id, {
    status: "ended",
    ended_at: new Date().toISOString(),
  });
}

// Ledger a period for a series. Returns "duplicate" when the period was
// already ledgered (the UNIQUE constraint fired) — callers treat that as
// "someone already did this", never as an error.
export async function recordOccurrence(input: {
  series_id: string;
  firm_id: string;
  period_key: string;
  engagement_id: string | null;
}): Promise<"created" | "duplicate"> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("recurring_occurrences").insert(input);
  if (error) {
    // 23505 = unique_violation: this (series, period) already spawned.
    if (error.code === "23505") return "duplicate";
    throw error;
  }
  return "created";
}

// Stamp an engagement with its series linkage (badge + series panel lookups).
// Best-effort semantics belong to the caller; this throws on real failures.
export async function linkEngagementToSeries(
  engagementId: string,
  seriesId: string,
  periodKey: string,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ series_id: seriesId, series_period: periodKey })
    .eq("id", engagementId);
  if (error) throw error;
}
