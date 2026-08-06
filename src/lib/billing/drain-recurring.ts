// The hourly drain: bill every schedule that is due (migration 1710).
//
// ── WHY IT RIDES THE RECURRENCES CRON ──────────────────────────────────────
//
// /api/cron/spawn-recurrences already runs hourly and already means "the
// scheduled things that should have happened by now, happen". Adding a second
// cron for the other kind of recurring thing would give this repo two answers
// to "where do scheduled charges live", and vercel.json is a shared config file
// the founder gates changes to. One cron, two drains.
//
// Hourly is a freshness knob, not a correctness one: the ledger's unique key is
// what makes a charge happen once, so running twice in the same hour is a no-op
// rather than a double bill.
//
// ── ONE PERIOD PER SCHEDULE PER RUN ────────────────────────────────────────
//
// resolveDueCharge() advances exactly one cycle and never skips (see
// recurring-charges.ts). A firm three months unbilled catches up over the next
// three hourly runs, in order, one invoice each — rather than losing two months
// silently or sending three invoices in the same second.

import {
  listDueBillingSchedulesSR,
  type BillingSchedule,
} from "@/lib/db/billing-schedules";
import { chargeSchedulePeriod, type ChargeOutcome } from "./charge-recurring";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

// Bounded like MAX_SERIES_PER_RUN, and for the same reason: an hourly cadence
// means a backlog larger than this simply drains over the following runs.
const MAX_SCHEDULES_PER_RUN = 50;

type FirmRow = {
  id: string;
  name: string;
  timezone: string;
  logo_url: string | null;
  connect_charges_enabled: boolean;
  paypal_merchant_id?: string | null;
  paypal_payments_receivable?: boolean | null;
  paypal_email_confirmed?: boolean | null;
};

export async function drainDueRecurringCharges(now: Date = new Date()): Promise<{
  checked: number;
  charged: number;
  results: { scheduleId: string; outcome: ChargeOutcome }[];
}> {
  const sb = getServiceRoleSupabase();

  // Generous UTC window (today + 1) so no firm timezone (up to UTC+14) is
  // missed; the precise firm-local decision happens per schedule in the runner.
  const window = new Date(now);
  window.setUTCDate(window.getUTCDate() + 1);
  const windowIso = window.toISOString().slice(0, 10);

  const schedules = await listDueBillingSchedulesSR(
    windowIso,
    MAX_SCHEDULES_PER_RUN,
  );
  const results: { scheduleId: string; outcome: ChargeOutcome }[] = [];
  if (schedules.length === 0) return { checked: 0, charged: 0, results };

  const firmById = await loadFirms(
    sb,
    [...new Set(schedules.map((s) => s.firm_id))],
  );

  let charged = 0;
  for (const schedule of schedules) {
    const firm = firmById.get(schedule.firm_id);
    if (!firm) {
      results.push({
        scheduleId: schedule.id,
        outcome: { ok: false, reason: "engagement_gone" },
      });
      continue;
    }
    try {
      const outcome = await chargeSchedulePeriod(
        schedule satisfies BillingSchedule,
        firm,
        now,
      );
      if (outcome.ok) charged += 1;
      results.push({ scheduleId: schedule.id, outcome });
    } catch (e) {
      // One bad schedule must never stop the rest of the firm's billing.
      console.error("[billing] schedule failed:", schedule.id, e);
      results.push({
        scheduleId: schedule.id,
        outcome: { ok: false, reason: "create_failed" },
      });
    }
  }
  return { checked: schedules.length, charged, results };
}

async function loadFirms(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  firmIds: string[],
): Promise<Map<string, FirmRow>> {
  // Both rails' readiness. Pre-0730 the paypal_* columns don't exist — retry
  // with the legacy select, exactly as sendEngagementInvoice does, so the drain
  // keeps working in a deploy-ahead-of-migrate window.
  const railCols =
    "id, name, timezone, logo_url, connect_charges_enabled, paypal_merchant_id, paypal_payments_receivable, paypal_email_confirmed";
  const first = await sb.from("firms").select(railCols).in("id", firmIds);
  let rows: unknown = first.data;
  let failure = first.error;
  if (failure && isMissingSchema(failure)) {
    const legacy = await sb
      .from("firms")
      .select("id, name, timezone, logo_url, connect_charges_enabled")
      .in("id", firmIds);
    rows = legacy.data;
    failure = legacy.error;
  }
  if (failure) {
    console.error("[billing] firm load failed:", failure.message);
    return new Map();
  }
  return new Map(((rows ?? []) as FirmRow[]).map((f) => [f.id, f]));
}
