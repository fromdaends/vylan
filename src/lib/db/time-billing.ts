// The billable side of time entries — time_entry_billing (migration 1780).
//
// Deliberately NOT part of time-entries.ts: that module's contract is "no
// dollar field can exist here", and this module is exactly the dollar field.
// Keeping them apart keeps the leak-check greppable: nothing that renders the
// shared-hours surfaces imports this file.
//
// VALUE MATH, once: value_cents = round(duration_minutes / 60 × rate × 100).
// The rate is the SNAPSHOT, never the live billable rate — a raise tomorrow
// must not reprice yesterday's saved entries.
//
// Reads run as the CALLER (RLS: own rows, or insights.view / rates.manage).
// The snapshot WRITE is service-role only — the table has no authenticated
// write policy at all, the same freeze as time_entry_costs.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export function valueCents(durationMinutes: number, rateSnapshot: number): number {
  return Math.round((durationMinutes / 60) * rateSnapshot * 100);
}

/** SERVICE ROLE: freeze the member's CURRENT billable rate onto one saved
 *  entry. No rate set = no row (the entry reads "no value", never $0).
 *  Failure is swallowed after logging — losing a value degrades one number;
 *  failing the save would lose the HOUR.
 *
 *  FREEZE-FIRST: ignoreDuplicates keeps the FIRST snapshot. Stop is
 *  idempotent (a second tab's stop replays it), and without this a replayed
 *  stop after a rate change would quietly reprice a saved entry — the exact
 *  history-rewrite the snapshot exists to prevent. v1 has no rate-edit UI, so
 *  nothing legitimately re-snapshots. */
export async function writeBillableSnapshotSR(input: {
  timeEntryId: string;
  firmId: string;
  userId: string;
}): Promise<void> {
  try {
    const supabase = getServiceRoleSupabase();
    const { data: rate } = await supabase
      .from("user_rates")
      .select("billable_rate_hourly")
      .eq("user_id", input.userId)
      .eq("firm_id", input.firmId)
      .maybeSingle();
    const billable = (rate as { billable_rate_hourly: number | string | null } | null)
      ?.billable_rate_hourly;
    if (billable == null) return;
    const { error } = await supabase.from("time_entry_billing").upsert(
      {
        time_entry_id: input.timeEntryId,
        firm_id: input.firmId,
        user_id: input.userId,
        billable_rate_snapshot: Number(billable),
      },
      { onConflict: "time_entry_id", ignoreDuplicates: true },
    );
    if (error && !isMissingSchema(error)) {
      console.error("[time-billing] snapshot failed:", error);
    }
  } catch (err) {
    console.error("[time-billing] snapshot failed:", err);
  }
}

/** Rate snapshots for a set of entries, as the CALLER — rows RLS hides are
 *  simply absent, so a staff member gets their own and a permitted viewer
 *  gets everyone's. Chunked .in() to stay under URL limits. */
export async function listBillableRates(
  entryIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (entryIds.length === 0) return out;
  const supabase = await getServerSupabase();
  const CHUNK = 100;
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("time_entry_billing")
      .select("time_entry_id, billable_rate_snapshot")
      .in("time_entry_id", entryIds.slice(i, i + CHUNK));
    if (error) {
      if (!isMissingSchema(error)) {
        console.error("[time-billing] rates read failed:", error);
      }
      return out;
    }
    for (const r of (data ?? []) as {
      time_entry_id: string;
      billable_rate_snapshot: number | string;
    }[]) {
      out.set(r.time_entry_id, Number(r.billable_rate_snapshot));
    }
  }
  return out;
}
