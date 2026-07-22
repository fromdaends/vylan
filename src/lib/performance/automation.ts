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

async function countAction(
  sb: SupabaseClient,
  action: string,
  range: ResolvedRange,
): Promise<number> {
  let q = sb
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("action", action);
  if (range.startIso) q = q.gte("created_at", range.startIso);
  const { count, error } = await q;
  if (error) {
    console.error(`[performance] countAction(${action}) failed:`, error);
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
