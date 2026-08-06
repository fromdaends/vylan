// Recurring billing schedules (migration 1710) — service-role readers/writers.
//
// Every function here degrades on a pre-1710 database rather than throwing: the
// code ships before the migration is applied, and until it is, a firm simply
// has no recurring schedules — which is exactly today's behaviour and is the
// honest answer, since nothing could have stored one either.

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import type { ChargeFrequency } from "@/lib/billing/recurring-charges";

export type BillingScheduleStatus = "active" | "paused" | "ended";

export type BillingSchedule = {
  id: string;
  firm_id: string;
  client_id: string;
  engagement_id: string;
  frequency: ChargeFrequency;
  anchor_day: number;
  next_charge_on: string;
  ends_on: string | null;
  status: BillingScheduleStatus;
  description: string | null;
  created_at: string;
  ended_at: string | null;
};

const COLS =
  "id, firm_id, client_id, engagement_id, frequency, anchor_day, next_charge_on, ends_on, status, description, created_at, ended_at";

/**
 * Schedules that may be due, oldest first.
 *
 * A generous UTC window (today + 1 day) so no firm timezone is missed; the
 * precise firm-local "is it due?" decision happens per schedule in the runner,
 * the same way spawnDueRecurrences does it.
 */
export async function listDueBillingSchedulesSR(
  windowIso: string,
  limit: number,
): Promise<BillingSchedule[]> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_billing_schedules")
    .select(COLS)
    .eq("status", "active")
    .lte("next_charge_on", windowIso)
    .order("next_charge_on", { ascending: true })
    .limit(limit);
  if (error) {
    // Pre-1710: no table, therefore no schedules. Not an error worth logging
    // on every hourly run of a deploy that is ahead of its migration.
    if (isMissingSchema(error)) return [];
    console.error("[billing-schedules] listDue failed:", error.message);
    return [];
  }
  return (data ?? []) as BillingSchedule[];
}

export async function listBillingSchedulesForEngagementSR(
  engagementId: string,
): Promise<BillingSchedule[]> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_billing_schedules")
    .select(COLS)
    .eq("engagement_id", engagementId)
    .order("next_charge_on", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    console.error("[billing-schedules] listForEngagement failed:", error.message);
    return [];
  }
  return (data ?? []) as BillingSchedule[];
}

/**
 * The engagement's schedules for its own page, through the user's session.
 *
 * RLS-scoped (the select policy is firm membership), and it carries the count
 * of periods already billed so the panel can say "billed 3 times so far"
 * without a second round trip.
 *
 * Returns [] on a pre-1710 database — an engagement page that 500s because a
 * migration has not landed is far worse than one with no schedule line, which
 * is the same rule listEngagementItems follows for 1450.
 */
export async function listBillingSchedulesForEngagement(
  engagementId: string,
): Promise<(BillingSchedule & { charges_so_far: number })[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_billing_schedules")
    .select(`${COLS}, engagement_billing_charges(count)`)
    .eq("engagement_id", engagementId)
    .order("next_charge_on", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    console.error("[billing-schedules] listForEngagement failed:", error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const nested = row.engagement_billing_charges;
    const count = Array.isArray(nested)
      ? Number((nested[0] as { count?: number } | undefined)?.count ?? 0)
      : 0;
    return {
      ...(row as unknown as BillingSchedule),
      charges_so_far: Number.isFinite(count) ? count : 0,
    };
  });
}

export type CreateBillingScheduleInput = {
  firm_id: string;
  client_id: string;
  engagement_id: string;
  frequency: ChargeFrequency;
  anchor_day: number;
  next_charge_on: string;
  ends_on?: string | null;
  description?: string | null;
};

/**
 * Start a schedule, or leave the existing one alone.
 *
 * UNIQUE(engagement_id, frequency) is what makes this safe to call more than
 * once: an acceptance recorded twice, or a retry after a partial failure,
 * cannot produce two schedules that both bill the same client for the same
 * work. A duplicate is a no-op, not an error.
 *
 * Returns null when the schedule could not be created (pre-1710, or a genuine
 * failure) — the caller treats that as "no recurring billing", never as a
 * reason to fail the acceptance that has already been recorded.
 */
export async function createBillingScheduleSR(
  input: CreateBillingScheduleInput,
): Promise<BillingSchedule | "duplicate" | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_billing_schedules")
    .insert({
      firm_id: input.firm_id,
      client_id: input.client_id,
      engagement_id: input.engagement_id,
      frequency: input.frequency,
      anchor_day: input.anchor_day,
      next_charge_on: input.next_charge_on,
      ends_on: input.ends_on ?? null,
      description: input.description ?? null,
    })
    .select(COLS)
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    if (!isMissingSchema(error)) {
      console.error("[billing-schedules] create failed:", error.message);
    }
    return null;
  }
  return data as BillingSchedule;
}

export async function advanceBillingScheduleSR(
  scheduleId: string,
  nextChargeOn: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("engagement_billing_schedules")
    .update({ next_charge_on: nextChargeOn })
    .eq("id", scheduleId);
  if (error && !isMissingSchema(error)) {
    console.error("[billing-schedules] advance failed:", error.message);
  }
}

/**
 * Bring a client's billing back when they are un-archived.
 *
 * ── THE TRAP THIS CLOSES ───────────────────────────────────────────────────
 *
 * chargeSchedulePeriod PAUSES a schedule when its client is archived — right,
 * because billing someone who has been shelved is worse than missing a month.
 * But nothing ever un-paused it. Un-archiving a client silently ended their
 * recurring revenue forever, with no error, no banner and nothing on screen
 * saying billing had stopped. The firm would find out when the money did not
 * arrive, months later, if at all.
 *
 * Only resumes what the ARCHIVE paused: an 'ended' schedule stayed ended (the
 * engagement was cancelled, or its lines were deleted), and a schedule the firm
 * paused deliberately would also be 'paused' — so this deliberately resumes
 * those too rather than inventing a second pause reason to tell them apart. A
 * firm that meant to stop it can stop it again in one click; a firm that never
 * meant to stop it would otherwise never know.
 *
 * Best-effort: un-archiving a client must not fail because a billing table is
 * missing or a write hiccuped.
 */
export async function resumeSchedulesForClientSR(
  clientId: string,
): Promise<number> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_billing_schedules")
    .update({ status: "active" })
    .eq("client_id", clientId)
    .eq("status", "paused")
    .select("id");
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[billing-schedules] resume failed:", error.message);
    }
    return 0;
  }
  return (data ?? []).length;
}

export async function setBillingScheduleStatusSR(
  scheduleId: string,
  status: BillingScheduleStatus,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("engagement_billing_schedules")
    .update({
      status,
      ...(status === "ended" ? { ended_at: new Date().toISOString() } : {}),
    })
    .eq("id", scheduleId);
  if (error && !isMissingSchema(error)) {
    console.error("[billing-schedules] setStatus failed:", error.message);
  }
}

/**
 * Burn a period BEFORE billing it. The unique key is the guarantee.
 *
 * Returns "duplicate" when the period was already taken — the caller advances
 * the schedule and bills nothing, so an overlapping run can never double-charge
 * a client. Returns null on a pre-1710 database, which the caller also treats
 * as "do not bill": without the ledger there is nothing preventing a second
 * charge, and billing twice is far worse than billing late.
 */
export async function claimBillingPeriodSR(input: {
  schedule_id: string;
  firm_id: string;
  period_key: string;
}): Promise<{ id: string } | "duplicate" | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_billing_charges")
    .insert({
      schedule_id: input.schedule_id,
      firm_id: input.firm_id,
      period_key: input.period_key,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate";
    if (!isMissingSchema(error)) {
      console.error("[billing-schedules] claimPeriod failed:", error.message);
    }
    return null;
  }
  return data as { id: string };
}

/** Free a claimed period so the next run can retry it. The compensating action
 *  when the invoice itself could not be raised. */
export async function releaseBillingPeriodSR(chargeId: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("engagement_billing_charges")
    .delete()
    .eq("id", chargeId)
    .is("payment_request_id", null);
  if (error) {
    // Loud: a burned period with no invoice means one cycle is silently never
    // billed. Rare (it needs the delete to fail too) and recoverable by hand,
    // but nobody can recover what they were never told about.
    console.error(
      "[billing-schedules] COMPENSATING DELETE FAILED — period burned without an invoice:",
      chargeId,
      error.message,
    );
  }
}

export async function linkChargeToPaymentRequestSR(
  chargeId: string,
  paymentRequestId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("engagement_billing_charges")
    .update({ payment_request_id: paymentRequestId })
    .eq("id", chargeId);
  if (error && !isMissingSchema(error)) {
    console.error("[billing-schedules] link failed:", error.message);
  }
}
