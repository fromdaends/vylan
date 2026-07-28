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
  // Cycle length for a 'custom' series (migration 0890); null for the fixed
  // frequencies, which derive their cycle from `frequency`. Optional on the
  // type so reads still parse before 0890 is applied.
  interval_months?: number | null;
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
  // Who new engagements spawned from this series go to (migration 0940).
  // Optional on the type so reads still parse before 0940 is applied — the
  // spawner falls through to created_by_user_id when it's absent.
  assigned_user_id?: string | null;
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

// Every series in the caller's firm, for the /repeating screen. RLS-scoped, so
// a staff member's list is silently shorter than an owner's (private clients
// and — since 0950 — private source engagements are filtered out in the DB).
//
// select("*") deliberately, NOT a named column list: naming assigned_user_id
// would 42703 on a database where 0940 hasn't been applied, taking the whole
// screen down. With "*" the column is simply absent from the row and the
// callers fall through to created_by_user_id, which is the old behaviour.
//
// Ordered so the DB does the coarse work (status, then soonest first) and the
// pure sortRows() does the presentation ordering.
export async function listRecurringSeries(): Promise<RecurringSeries[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("recurring_series")
    .select("*")
    .order("status", { ascending: true })
    .order("next_spawn_on", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? []) as RecurringSeries[];
}

// Change who new engagements from a series are assigned to. Callers MUST have
// already loaded the series through getRecurringSeries (RLS-scoped) — see the
// authorizeSeries prologue in app/actions/recurring.ts. This function does not
// re-check, and the service role is never used here on purpose: the write goes
// through the caller's own session so recurring_series_update (0950) applies.
//
// Returns false — never throws — when 0940 isn't applied, so the UI can say
// "not switched on yet" instead of showing a 500.
export async function setSeriesAssignee(
  seriesId: string,
  userId: string | null,
): Promise<boolean> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("recurring_series")
    .update({ assigned_user_id: userId })
    .eq("id", seriesId);
  if (error) {
    if (isMissingSchema(error)) return false;
    throw error;
  }
  return true;
}

// Live (not ended) schedules per assignee, for the team roster and — the
// reason it exists — the guarded-offboarding dialog. Without this, someone
// whose entire footprint is recurring schedules reports as holding nothing,
// so the owner is never asked where that work should go.
//
// RLS-scoped (the caller's own firm). Returns an empty map when 0770/0940
// aren't applied here, so the team page renders either way.
export async function countLiveSeriesByAssignee(): Promise<
  Map<string, number>
> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("recurring_series")
    .select("assigned_user_id")
    .neq("status", "ended");
  if (error) {
    if (isMissingSchema(error)) return new Map();
    throw error;
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { assigned_user_id: string | null }[]) {
    const id = row.assigned_user_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export type CreateRecurringSeriesInput = {
  firm_id: string;
  client_id: string;
  source_engagement_id: string | null;
  title: string;
  type: EngagementType;
  frequency: RecurringFrequency;
  // Only for frequency 'custom' (migration 0890). Omitted/null otherwise.
  interval_months?: number | null;
  anchor_day: number;
  due_offset_days: number;
  items: TemplateItem[];
  ai_enabled: boolean;
  reminder_settings: ReminderSettings | null;
  next_spawn_on: string;
  created_by_user_id: string | null;
  // Invoice recurrence (Phase 4). Snapshot shape lives in
  // src/lib/recurring/invoice-snapshot.ts; stored as JSONB.
  invoice_recreate?: boolean;
  invoice_snapshot?: Record<string, unknown> | null;
};

export async function createRecurringSeries(
  input: CreateRecurringSeriesInput,
): Promise<RecurringSeries> {
  const supabase = await getServerSupabase();
  // Only send interval_months when there is one (a custom series). A fixed
  // monthly/quarterly/yearly series therefore inserts EXACTLY the same columns
  // as before 0890, so those keep working in a deploy-ahead-of-SQL window;
  // only the new custom option needs the column to exist.
  const { interval_months, ...rest } = input;
  const base =
    interval_months == null ? rest : { ...rest, interval_months };
  // A new series is owned by whoever set it up. Stored EXPLICITLY (0940) and
  // not left to the backfill, which only ran once — otherwise every series
  // created after the migration would keep a null assignee, and offboarding
  // (which matches on assigned_user_id) would silently miss all of them.
  //
  // Dropped independently on a pre-0940 DB so creating a schedule still works
  // ahead of the SQL; the spawner falls through to created_by_user_id there,
  // which is exactly the old behaviour.
  const first = await supabase
    .from("recurring_series")
    .insert({ ...base, assigned_user_id: base.created_by_user_id })
    .select("*")
    .single();
  if (!first.error) return first.data as RecurringSeries;
  if (!isMissingSchema(first.error)) throw first.error;

  const { data, error } = await supabase
    .from("recurring_series")
    .insert(base)
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
      | "interval_months"
      | "anchor_day"
      | "due_offset_days"
      | "items"
      | "ai_enabled"
      | "reminder_settings"
      | "invoice_recreate"
      | "invoice_snapshot"
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
