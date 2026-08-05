// The KPI alert sweep — reads every firm's alerts, recomputes the number each
// one watches, and notifies on a crossing.
//
// ⚠️ THE NUMBER IS COMPUTED THE SAME WAY THE CARD COMPUTES IT.
//
// taskKpis() is the function the Work overview renders from. Re-deriving
// "overdue" in SQL here would give the alert its own definition of late, and
// the first time the two disagreed the person would be told a number they
// could not find on the page. So this reads rows and calls the same function.
//
// Service-role client: a cron has no session, and RLS would return nothing.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { taskKpis, type MetricTask } from "@/lib/dashboard/work-metrics";
import { decideAlert, type AlertRule } from "@/lib/dashboard/alert-eval";
import { todayInTimeZone } from "@/lib/tasks/dates";

type AlertRow = {
  id: string;
  firm_id: string;
  user_id: string;
  surface: "tasks" | "engagements";
  metric: "open" | "overdue" | "completed" | "percent_complete";
  comparator: "gt" | "lt";
  threshold: number;
  frequency: AlertRule["frequency"];
  name: string;
  message: string | null;
  subscriber_ids: string[] | null;
  last_value: number | null;
  last_fired_at: string | null;
};

export type SweepResult = {
  checked: number;
  fired: number;
  skipped?: "schema_missing";
};

/** Missing table — the migration has not been applied yet. Not an error. */
function isMissingTable(err: { code?: string | null } | null): boolean {
  return err?.code === "PGRST205" || err?.code === "42P01";
}

export async function runKpiAlerts(now = new Date()): Promise<SweepResult> {
  const sb = getServiceRoleSupabase();

  const { data, error } = await sb
    .from("kpi_alerts")
    .select(
      "id, firm_id, user_id, surface, metric, comparator, threshold, frequency, name, message, subscriber_ids, last_value, last_fired_at",
    );
  if (error) {
    if (isMissingTable(error)) return { checked: 0, fired: 0, skipped: "schema_missing" };
    console.error("[kpi-alerts] sweep read failed:", error);
    return { checked: 0, fired: 0 };
  }
  const alerts = (data as AlertRow[] | null) ?? [];
  if (alerts.length === 0) return { checked: 0, fired: 0 };

  // Group by firm so the rows behind a number are read ONCE per firm, not once
  // per alert. A firm with four alerts on the tasks tab is one query.
  const byFirm = new Map<string, AlertRow[]>();
  for (const a of alerts) {
    byFirm.set(a.firm_id, [...(byFirm.get(a.firm_id) ?? []), a]);
  }

  let fired = 0;

  for (const [firmId, firmAlerts] of byFirm) {
    const { data: firmRow } = await sb
      .from("firms")
      .select("timezone")
      .eq("id", firmId)
      .maybeSingle();
    const today = todayInTimeZone(
      (firmRow as { timezone?: string } | null)?.timezone ?? "America/Toronto",
    );

    const needs = new Set(firmAlerts.map((a) => a.surface));
    const values = new Map<string, number>();

    if (needs.has("tasks")) {
      const { data: rows } = await sb
        .from("engagement_tasks")
        .select("id, kind, status, status_id, due_date, created_at, completed_at")
        .eq("firm_id", firmId)
        .is("deleted_at", null)
        .is("parent_id", null);
      const tasks: MetricTask[] = ((rows as Record<string, unknown>[] | null) ?? []).map(
        (r) => ({
          id: String(r.id),
          kind: String(r.kind ?? "task"),
          status: (r.status as MetricTask["status"]) ?? "todo",
          statusId: (r.status_id as string | null) ?? null,
          dueDate: (r.due_date as string | null) ?? null,
          createdAt: (r.created_at as string | null) ?? null,
          completedAt: (r.completed_at as string | null) ?? null,
        }),
      );
      const k = taskKpis(tasks, today);
      values.set("tasks:open", k.open);
      values.set("tasks:overdue", k.overdue);
      values.set("tasks:completed", k.completed);
      values.set("tasks:percent_complete", k.percentComplete);
    }

    if (needs.has("engagements")) {
      const { data: rows } = await sb
        .from("engagements")
        .select("id, due_date, created_at, completed_at")
        .eq("firm_id", firmId);
      // Shaped into the same type so ONE function answers both tabs — the same
      // trick the page uses.
      const list: MetricTask[] = ((rows as Record<string, unknown>[] | null) ?? []).map(
        (r) => ({
          id: String(r.id),
          kind: "engagement",
          status: r.completed_at ? "done" : "doing",
          dueDate: (r.due_date as string | null) ?? null,
          createdAt: (r.created_at as string | null) ?? null,
          completedAt: (r.completed_at as string | null) ?? null,
        }),
      );
      const k = taskKpis(list, today);
      values.set("engagements:open", k.open);
      values.set("engagements:overdue", k.overdue);
      values.set("engagements:completed", k.completed);
      values.set("engagements:percent_complete", k.percentComplete);
    }

    for (const a of firmAlerts) {
      const value = values.get(`${a.surface}:${a.metric}`);
      if (value === undefined) continue;

      const decision = decideAlert(value, {
        id: a.id,
        comparator: a.comparator,
        threshold: Number(a.threshold),
        frequency: a.frequency,
        lastValue: a.last_value === null ? null : Number(a.last_value),
        lastFiredAt: a.last_fired_at,
      }, now);

      if (decision.fire) {
        // Through the SAME notify() as every other event, so per-person
        // preferences, mutes, quiet hours and digests all apply without this
        // sweep knowing they exist.
        await notify({
          firmId,
          eventKey: "firm.kpi_alert",
          recipients:
            a.subscriber_ids && a.subscriber_ids.length > 0
              ? a.subscriber_ids
              : [a.user_id],
          payload: {
            // documentName is the generic string slot the email copy reads —
            // see email-copy.ts for why the alert's name rides there.
            document_name: a.name,
            count: 1,
            note: a.message ?? null,
            value,
            threshold: Number(a.threshold),
            href: "/work/overview",
          },
        });
        fired++;
      }

      // ALWAYS write the reading back, fired or not — last_value is what makes
      // "it was already over the line yesterday" decidable, and skipping the
      // write on a quiet check would make every day look like a fresh crossing.
      await sb
        .from("kpi_alerts")
        .update({
          last_value: value,
          last_checked_at: now.toISOString(),
          ...(decision.fire ? { last_fired_at: now.toISOString() } : {}),
        })
        .eq("id", a.id);
    }
  }

  return { checked: alerts.length, fired };
}
