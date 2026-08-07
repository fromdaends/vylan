// The ONE answer to "what cadence does this engagement's invoice chase run?"
//
// A flow may carry its own invoice-chase opinion (workflow snapshot,
// reminders.invoice); when it does — and the firm's workflows switch is on —
// that opinion outranks the firm default. Every path that schedules or
// RE-schedules a chase resolves through here, because the first bug this file
// exists to prevent is exactly the one review found: send-time honoured the
// flow, then one "Remind now" click rebuilt the queue from firm defaults and
// the flow's cadence was silently lost for the rest of the invoice's life.
//
// Server-only (Supabase client in, no session assumptions): callers hand in
// whichever client fits their context — service-role from cron paths, the
// user's RLS client from server actions. Fail-soft: any read hiccup returns
// the base settings unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChaseSettings } from "@/lib/invoices/chase-settings";
import { parseWorkflowSnapshot } from "@/lib/workflow/definition";
import { isWorkflowsEnabledForFirm } from "@/lib/workflow/flags";

export async function chaseSettingsWithFlowOverride(
  sb: SupabaseClient,
  opts: {
    base: ChaseSettings;
    engagementId: string | null;
    firmId: string;
  },
): Promise<ChaseSettings> {
  if (!opts.engagementId) return opts.base;
  try {
    const { data } = await sb
      .from("engagements")
      .select("workflow")
      .eq("id", opts.engagementId)
      .maybeSingle();
    const inv = parseWorkflowSnapshot(
      (data as { workflow?: unknown } | null)?.workflow,
    )?.reminders?.invoice;
    if (!inv) return opts.base;
    // Flag off = byte-identical legacy, even for rows still carrying a
    // snapshot from when it was on.
    if (!(await isWorkflowsEnabledForFirm(sb, opts.firmId))) return opts.base;
    return {
      enabledDefault: inv.enabled,
      intervalDays: inv.intervalDays,
      maxReminders: inv.maxReminders,
    };
  } catch {
    return opts.base;
  }
}
