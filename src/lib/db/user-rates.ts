// Hourly rates — reading and writing user_rates (migration 1750).
//
// THE TABLE IS THE SECRET-KEEPER, this module is just hands. user_rates is
// RLS-gated on the rates.manage capability (roles only — the founder's
// ruling), so every read here goes through the CALLER'S OWN session: a holder
// gets rows, anybody else gets an empty answer from the database itself, and
// this module never has to decide who is allowed — it could not get the
// decision wrong if it tried.
//
// The ONE deliberate exception is getCostRateForUserSR: the service-role read
// used at time-entry creation to snapshot the author's CURRENT rate into
// time_entry_costs. A staff member logging their own hour cannot read their
// own rate (by design), so their session cannot write the snapshot; the
// server action does it over their head. It is the only reason service role
// appears in this file.
//
// READS DEGRADE, WRITES REFUSE (the engagement-tasks shape): before 1750 is
// applied there is no table — reads answer "no rates set", which is true, and
// writes name the migration.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type UserRate = {
  user_id: string;
  cost_rate_hourly: number | null;
  billable_rate_hourly: number | null;
};

export class UserRatesUnsupportedError extends Error {
  constructor() {
    super("user_rates is not available — apply supabase/migrations/1750");
    this.name = "UserRatesUnsupportedError";
  }
}

/** Every rate row the CALLER may see. rates.manage holders get the firm's
 *  rates; everyone else gets [] — from RLS, not from a filter here. */
export async function listUserRates(): Promise<UserRate[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("user_rates")
    .select("user_id, cost_rate_hourly, billable_rate_hourly");
  if (error) {
    if (isMissingSchema(error)) return [];
    console.error("[user-rates] list failed:", error);
    return [];
  }
  return (data ?? []) as UserRate[];
}

/** Set (or clear — null) a member's rates. Runs as the CALLER, so RLS refuses
 *  anyone without rates.manage; the action layer checks first only to say why. */
export async function upsertUserRate(input: {
  userId: string;
  firmId: string;
  costRateHourly: number | null;
  billableRateHourly: number | null;
  updatedByUserId: string;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("user_rates").upsert(
    {
      user_id: input.userId,
      firm_id: input.firmId,
      cost_rate_hourly: input.costRateHourly,
      billable_rate_hourly: input.billableRateHourly,
      updated_at: new Date().toISOString(),
      updated_by_user_id: input.updatedByUserId,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    if (isMissingSchema(error)) throw new UserRatesUnsupportedError();
    throw error;
  }
}

/** SERVICE ROLE: the author's current cost rate, for the creation-time
 *  snapshot. Firm-scoped so a bug upstream cannot read across tenants. Null =
 *  no rate set (the entry stays snapshot-less and is excluded from cost math,
 *  never counted as free). */
export async function getCostRateForUserSR(
  userId: string,
  firmId: string,
): Promise<number | null> {
  try {
    const supabase = getServiceRoleSupabase();
    const { data, error } = await supabase
      .from("user_rates")
      .select("cost_rate_hourly")
      .eq("user_id", userId)
      .eq("firm_id", firmId)
      .maybeSingle();
    if (error || !data) return null;
    const rate = (data as { cost_rate_hourly: number | string | null })
      .cost_rate_hourly;
    return rate == null ? null : Number(rate);
  } catch {
    return null;
  }
}

/** SERVICE ROLE: freeze the rate onto one entry. Failure is swallowed after
 *  logging — losing a snapshot degrades one cost estimate (the entry shows as
 *  "no rate", the banner counts it); failing the entry would lose the HOUR. */
export async function writeCostSnapshotSR(
  timeEntryId: string,
  firmId: string,
  costRateSnapshot: number,
): Promise<void> {
  try {
    const supabase = getServiceRoleSupabase();
    const { error } = await supabase.from("time_entry_costs").insert({
      time_entry_id: timeEntryId,
      firm_id: firmId,
      cost_rate_snapshot: costRateSnapshot,
    });
    if (error && !isMissingSchema(error)) {
      console.error("[user-rates] cost snapshot failed:", error);
    }
  } catch (err) {
    console.error("[user-rates] cost snapshot failed:", err);
  }
}
