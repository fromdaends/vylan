// Automation loader. Counts the quiet work Vylan did for the firm in range:
// reminders it sent automatically, and re-requests it fired after auto-rejecting
// a document. Both are permanent activity_log rows (RLS-scoped to the firm), so
// these are exact counts of real send events — never estimates.
//
//   reminder_fired          → one row per automatic reminder actually sent.
//   client_retry_email_sent → one email per auto-reject re-request (email is
//                             always the primary channel), so this is the clean
//                             one-per-event count of automated re-requests.
//   client_retry_sms_sent   → the companion text, tracked separately.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveRange, type ResolvedRange } from "./range";
import type { AutomationSection, PerformanceRange } from "./types";

// The 0820 "count but don't name" RPC may not be applied yet (PGRST202/42883) —
// fall back to the RLS-scoped head count, which undercounts a private client's
// automation events for staff until 0820 lands.
function isMissingFunction(err: { code?: string } | null): boolean {
  return err?.code === "PGRST202" || err?.code === "42883";
}

// Firm-wide count of an automation action in range, INCLUDING private clients
// (so staff see honest totals) via the 0820 definer RPC; RLS fallback otherwise.
async function countAction(
  sb: SupabaseClient,
  action: string,
  range: ResolvedRange,
): Promise<number> {
  const { data, error } = await sb.rpc("perf_action_count", {
    p_action: action,
    p_start: range.startIso ?? null,
  });
  if (!error) return (data as number | null) ?? 0;
  if (!isMissingFunction(error)) {
    console.error(`[performance] perf_action_count(${action}) rpc failed:`, error);
  }
  let q = sb
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("action", action);
  if (range.startIso) q = q.gte("created_at", range.startIso);
  const { count, error: rlsErr } = await q;
  if (rlsErr) {
    console.error(`[performance] countAction(${action}) failed:`, rlsErr);
    return 0;
  }
  return count ?? 0;
}

export async function loadAutomationSection(
  range: ResolvedRange,
): Promise<AutomationSection> {
  const sb = await getServerSupabase();
  const [remindersSent, reRequestEmails, reRequestTexts] = await Promise.all([
    countAction(sb, "reminder_fired", range),
    countAction(sb, "client_retry_email_sent", range),
    countAction(sb, "client_retry_sms_sent", range),
  ]);
  return { remindersSent, reRequestEmails, reRequestTexts };
}

// Convenience for the page: resolve the range and load the automation counts in
// one call. The clock is read HERE (a lib function), not in the server
// component's render, so the page stays pure. `nowMs` is injectable for tests.
export async function loadAutomation(
  range: PerformanceRange,
  nowMs: number = Date.now(),
): Promise<AutomationSection> {
  return loadAutomationSection(resolveRange(range, nowMs));
}
