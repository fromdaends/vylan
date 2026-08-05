// KPI alerts (1690) — CRUD for the bell on a Work overview card.
//
// Degrades to "none" before the migration is applied, exactly like saved
// views: a missing table must render a page that looks like it did before the
// feature existed, not an error.

import { getServerSupabase } from "@/lib/supabase/server";
import type {
  AlertComparator,
  AlertFrequency,
  AlertMetric,
} from "@/lib/dashboard/alert-eval";

export type KpiAlertSurface = "tasks" | "engagements";

export type KpiAlert = {
  id: string;
  surface: KpiAlertSurface;
  metric: AlertMetric;
  comparator: AlertComparator;
  threshold: number;
  frequency: AlertFrequency;
  name: string;
  message: string | null;
  subscriberIds: string[];
  lastValue: number | null;
  lastFiredAt: string | null;
};

const SELECT =
  "id, surface, metric, comparator, threshold, frequency, name, message, subscriber_ids, last_value, last_fired_at";

/** Missing TABLE (PGRST205 / 42P01) — degrade to none until 1690 lands. */
function isMissingTable(err: { code?: string | null } | null): boolean {
  return err?.code === "PGRST205" || err?.code === "42P01";
}

function toAlert(row: Record<string, unknown>): KpiAlert | null {
  const surface = row.surface;
  if (surface !== "tasks" && surface !== "engagements") return null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  return {
    id: String(row.id),
    surface,
    metric: row.metric as AlertMetric,
    comparator: row.comparator === "lt" ? "lt" : "gt",
    threshold: Number(row.threshold) || 0,
    frequency: (row.frequency as AlertFrequency) ?? "daily",
    name,
    message: typeof row.message === "string" && row.message.trim() ? row.message : null,
    subscriberIds: Array.isArray(row.subscriber_ids)
      ? (row.subscriber_ids as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [],
    lastValue: row.last_value === null || row.last_value === undefined
      ? null
      : Number(row.last_value),
    lastFiredAt:
      typeof row.last_fired_at === "string" ? row.last_fired_at : null,
  };
}

/** My alerts. [] before 1690 / on error — the bells just render unlit. */
export async function listMyKpiAlerts(): Promise<KpiAlert[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("kpi_alerts")
    .select(SELECT)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingTable(error)) console.error("[kpi-alerts] list failed:", error);
    return [];
  }
  return ((data as Array<Record<string, unknown>> | null) ?? [])
    .map(toAlert)
    .filter((a): a is KpiAlert => a !== null);
}

export type SaveAlertResult =
  | { ok: true; alert: KpiAlert }
  | { ok: false; error: "duplicate" | "not_ready" | "bad_input" | "failed" };

export async function createKpiAlert(input: {
  firmId: string;
  userId: string;
  surface: KpiAlertSurface;
  metric: AlertMetric;
  comparator: AlertComparator;
  threshold: number;
  frequency: AlertFrequency;
  name: string;
  message: string | null;
  subscriberIds: string[];
}): Promise<SaveAlertResult> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("kpi_alerts")
    .insert({
      firm_id: input.firmId,
      user_id: input.userId,
      surface: input.surface,
      metric: input.metric,
      comparator: input.comparator,
      threshold: input.threshold,
      frequency: input.frequency,
      name: input.name,
      message: input.message,
      subscriber_ids: input.subscriberIds,
    })
    .select(SELECT)
    .single();

  if (error) {
    if (isMissingTable(error)) return { ok: false, error: "not_ready" };
    if (error.code === "23505") return { ok: false, error: "duplicate" };
    // A CHECK constraint rejecting a bad comparator/metric is bad input, not a
    // server fault — say so rather than showing "something went wrong".
    if (error.code === "23514") return { ok: false, error: "bad_input" };
    console.error("[kpi-alerts] create failed:", error);
    return { ok: false, error: "failed" };
  }
  const alert = toAlert(data as Record<string, unknown>);
  return alert ? { ok: true, alert } : { ok: false, error: "failed" };
}

export async function deleteKpiAlert(id: string): Promise<{ ok: boolean }> {
  const sb = await getServerSupabase();
  const { error } = await sb.from("kpi_alerts").delete().eq("id", id);
  if (error) {
    console.error("[kpi-alerts] delete failed:", error);
    return { ok: false };
  }
  return { ok: true };
}
