// Starting the recurring billing schedules an accepted proposal implies (1710).
//
// ── WHEN ───────────────────────────────────────────────────────────────────
//
// On acceptance, alongside the deposit. That is the moment the client has
// agreed to the arrangement, and it is the same moment the proposal's own
// "$400/month" line becomes a commitment rather than a quote.
//
// ── WHERE THE FIRST CHARGE LANDS ───────────────────────────────────────────
//
// The engagement's `start_date` when it has one and it is still ahead, else
// today. That is the billing block's "engagement start" timing, which is its
// default and the one every existing engagement carries.
//
// Its "custom date" timing is NOT honoured yet, and cannot be: block timing is
// not persisted anywhere — flattenBlocks() writes each line's frequency onto
// engagement_items and drops the block's own fields, and the proposal snapshot
// keeps no copy. Storing it is a separate change to the write path; until then
// a custom start silently behaves as an engagement start, which is the safe
// direction (billing begins no later than agreed, never earlier).

import {
  createBillingScheduleSR,
  type BillingSchedule,
} from "@/lib/db/billing-schedules";
import {
  isChargeFrequency,
  type ChargeFrequency,
} from "@/lib/billing/recurring-charges";
import { isAutoBillable } from "@/lib/billing/charge-recurring";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

/**
 * Which frequencies this engagement actually bills on, and what to call them.
 *
 * ONE schedule per frequency, not per line: a client who agreed to three
 * monthly services gets one monthly invoice listing all three — what a firm
 * sends, and what the proposal's own totals panel already shows them. An
 * engagement with monthly AND quarterly lines gets two schedules, which is
 * right: they fall due on different days for different amounts.
 */
export type ScannableLine = {
  billing_frequency?: unknown;
  rate_cents?: unknown;
  rate_type?: unknown;
  name?: unknown;
  /** WHEN the block said to start (1740). */
  billing_timing?: unknown;
  billing_start_date?: unknown;
};

/**
 * The pure rule: which frequencies these lines can actually be billed on.
 *
 * Four exclusions, each of which would otherwise produce a schedule that
 * charges nothing forever — or worse, charges the wrong thing:
 *
 *   * "once" (and anything unrecognised) is not a schedule at all.
 *   * A line with NO RATE is "we will tell you later" — a real answer on a
 *     proposal, but there is nothing to charge, and a $0.00 monthly invoice
 *     has promised the work for free.
 *   * An HOURLY line has a rate PER HOUR and no known number of hours. Billing
 *     it as a flat amount every month invents a figure nobody quoted. Same rule
 *     hasStatableTotal enforces on every number the client sees.
 *   * An unnamed line is a blank row the accountant never filled in.
 *
 * Shares isAutoBillable with the charge itself, so a frequency that starts a
 * schedule is always one that can actually produce an invoice.
 *
 * Deduplicated, because three monthly services are ONE monthly invoice.
 */
export function schedulableFrequencies(
  lines: readonly ScannableLine[],
): ChargeFrequency[] {
  const found = new Set<ChargeFrequency>();
  for (const line of lines) {
    if (!isChargeFrequency(line.billing_frequency)) continue;
    if (!isAutoBillable(line as Record<string, unknown>)) continue;
    found.add(line.billing_frequency);
  }
  return [...found];
}

/**
 * The date a frequency's block said to START billing, if it named one (1740).
 *
 * The picker offered "from a date you pick" with nowhere to pick one, so it
 * silently meant "from the engagement start". Now a block can carry a real date
 * and this is where it takes effect.
 *
 * Only honoured when the line says timing='custom_date'. The EARLIEST such date
 * wins if two lines in one frequency disagree — billing should begin no later
 * than any line promised, which is the safe direction for the client.
 */
export function customStartFor(
  lines: readonly ScannableLine[],
  frequency: ChargeFrequency,
): string | null {
  let earliest: string | null = null;
  for (const line of lines) {
    if (line.billing_frequency !== frequency) continue;
    if (line.billing_timing !== "custom_date") continue;
    const d = line.billing_start_date;
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    if (earliest == null || d < earliest) earliest = d.slice(0, 10);
  }
  return earliest;
}

export async function recurringLinesForScan(
  engagementId: string,
): Promise<ScannableLine[]> {
  const sb = getServiceRoleSupabase();
  const full =
    "billing_frequency, rate_cents, rate_type, name, billing_timing, billing_start_date";
  const first = await sb
    .from("engagement_items")
    .select(full)
    .eq("engagement_id", engagementId);
  let rows: unknown = first.data;
  let failure = first.error;
  // Pre-1740: retry without the timing columns. The schedules still start, they
  // simply start at the engagement start rather than a custom date — which is
  // exactly what they did before the columns existed.
  if (failure && failure.code === "42703") {
    const legacy = await sb
      .from("engagement_items")
      .select("billing_frequency, rate_cents, rate_type, name")
      .eq("engagement_id", engagementId);
    rows = legacy.data;
    failure = legacy.error;
  }
  if (failure) {
    if (!isMissingSchema(failure)) {
      console.error("[billing] frequency scan failed:", failure.message);
    }
    return [];
  }
  return (rows ?? []) as ScannableLine[];
}

export async function recurringFrequenciesFor(
  engagementId: string,
): Promise<ChargeFrequency[]> {
  return schedulableFrequencies(await recurringLinesForScan(engagementId));
}

export type StartedSchedules = {
  started: ChargeFrequency[];
  /** Already existed — a re-run, not a second arrangement. */
  existing: ChargeFrequency[];
};

/**
 * Create the schedules an accepted engagement needs.
 *
 * Idempotent by construction: UNIQUE(engagement_id, frequency) means an
 * acceptance recorded twice, or a retry after a partial failure, cannot leave a
 * client billed twice for one arrangement. A duplicate is reported, not raised.
 */
export async function startRecurringSchedules(
  engagementId: string,
  today: string,
): Promise<StartedSchedules> {
  const out: StartedSchedules = { started: [], existing: [] };

  const lines = await recurringLinesForScan(engagementId);
  const frequencies = schedulableFrequencies(lines);
  if (frequencies.length === 0) return out;

  const sb = getServiceRoleSupabase();
  const { data: engRow } = await sb
    .from("engagements")
    .select("id, firm_id, client_id, title")
    .eq("id", engagementId)
    .maybeSingle();
  const engagement = engRow as {
    firm_id: string;
    client_id: string;
    title: string;
  } | null;
  if (!engagement) return out;

  // start_date is read separately and best-effort: it arrived in 1510, and an
  // environment without it simply starts billing today.
  let startDate: string | null = null;
  const { data: startRow } = await sb
    .from("engagements")
    .select("start_date")
    .eq("id", engagementId)
    .maybeSingle();
  startDate = (startRow?.start_date as string | null) ?? null;

  // Never bill for a period that has already passed before the client agreed.
  const engagementStart = startDate && startDate > today ? startDate : today;

  for (const frequency of frequencies) {
    // A block that named its own start date wins over the engagement's — that
    // is the whole point of "from a date you pick" (1740). Still floored at
    // today, so a date already in the past cannot bill for periods that elapsed
    // before anyone agreed.
    const custom = customStartFor(lines, frequency);
    const firstCharge =
      custom && custom > today ? custom : engagementStart;
    const anchorDay = Number(firstCharge.slice(8, 10)) || 1;

    const created: BillingSchedule | "duplicate" | null =
      await createBillingScheduleSR({
        firm_id: engagement.firm_id,
        client_id: engagement.client_id,
        engagement_id: engagementId,
        frequency,
        anchor_day: anchorDay,
        next_charge_on: firstCharge,
        description: engagement.title,
      });
    if (created === "duplicate") out.existing.push(frequency);
    else if (created) out.started.push(frequency);
  }
  return out;
}
