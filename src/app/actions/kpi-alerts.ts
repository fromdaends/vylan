"use server";

// KPI alerts (1690) — create and delete a threshold watch on a Work overview
// card.
//
// No capability gate: like saved views, these are PERSONAL. RLS scopes every
// path to user_id = auth.uid(), so this layer only adds validation and the firm
// id the row needs.
//
// This file exports async functions ONLY — a "use server" module with a sync
// export typechecks, lints, passes every test, and then fails the production
// build naming something else entirely.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  createKpiAlert,
  deleteKpiAlert,
  type KpiAlert,
  type KpiAlertSurface,
} from "@/lib/db/kpi-alerts";
import type {
  AlertComparator,
  AlertFrequency,
  AlertMetric,
} from "@/lib/dashboard/alert-eval";
import { revalidateAllLocales } from "@/lib/revalidate";

export type KpiAlertActionResult = {
  ok: boolean;
  alert?: KpiAlert;
  error?:
    | "no_session"
    | "bad_input"
    | "bad_name"
    | "duplicate"
    | "not_ready"
    | "failed";
};

const METRICS: AlertMetric[] = ["open", "overdue", "completed", "percent_complete"];
const FREQUENCIES: AlertFrequency[] = ["hourly", "daily", "weekly", "monthly"];
const NAME_MAX = 80;

export async function createKpiAlertAction(input: {
  surface: KpiAlertSurface;
  metric: AlertMetric;
  comparator: AlertComparator;
  threshold: number;
  frequency: AlertFrequency;
  name: string;
  message?: string | null;
  subscriberIds?: string[];
}): Promise<KpiAlertActionResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };

  // Validated here as well as by the CHECK constraints. The database is the
  // backstop; a named error is what lets the dialog say something useful.
  if (input.surface !== "tasks" && input.surface !== "engagements") {
    return { ok: false, error: "bad_input" };
  }
  if (!METRICS.includes(input.metric)) return { ok: false, error: "bad_input" };
  if (input.comparator !== "gt" && input.comparator !== "lt") {
    return { ok: false, error: "bad_input" };
  }
  if (!FREQUENCIES.includes(input.frequency)) {
    return { ok: false, error: "bad_input" };
  }
  // NaN and Infinity both survive a `typeof === "number"` check and both make
  // a threshold that can never be crossed.
  if (!Number.isFinite(input.threshold)) return { ok: false, error: "bad_input" };

  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) return { ok: false, error: "bad_name" };

  const message = input.message?.trim() ? input.message.trim().slice(0, 500) : null;

  const res = await createKpiAlert({
    firmId: firm.id,
    userId: user.id,
    surface: input.surface,
    metric: input.metric,
    comparator: input.comparator,
    threshold: input.threshold,
    frequency: input.frequency,
    name,
    message,
    // Deduped, and never empty of the creator: an alert nobody receives is a
    // row that does nothing.
    subscriberIds: [...new Set([...(input.subscriberIds ?? []), user.id])],
  });

  if (!res.ok) return { ok: false, error: res.error };
  revalidateAllLocales("/work/overview");
  return { ok: true, alert: res.alert };
}

export async function deleteKpiAlertAction(input: {
  id: string;
}): Promise<KpiAlertActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };
  // RLS does the ownership check — a delete of somebody else's id simply
  // matches no row.
  const res = await deleteKpiAlert(input.id);
  if (!res.ok) return { ok: false, error: "failed" };
  revalidateAllLocales("/work/overview");
  return { ok: true };
}
