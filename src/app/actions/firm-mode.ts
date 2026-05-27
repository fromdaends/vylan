"use server";

import { revalidatePath } from "next/cache";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";

// Result returned to the GoLiveCard's useActionState. `ok=true`
// includes the number of engagements that had their reminders
// resumed so the UI can show the operator what actually happened.
export type ConvertToLiveState = {
  ok: boolean;
  error?: "no_session" | "owner_only" | "already_live" | "update_failed";
  unpausedCount?: number;
} | null;

// Owner-only. Flips firms.is_demo → false (which removes the demo
// banner, removes the demo block modals on Add client / Send /
// Send reminder, etc.) AND clears reminders_paused on every
// engagement in the firm so the cron worker actually fires the
// reminder jobs it already queued.
//
// Service-role write: we update two tables and want the second one
// not to be gated by RLS — and the caller is already verified as an
// owner of an is_demo firm at the top of the function.
//
// Idempotent: if the firm is already live we return `already_live`
// rather than no-op-ing silently so the UI can show a calmer
// "already done" state instead of "Switching…".
export async function convertToLiveAction(
  _prev: ConvertToLiveState,
  _formData: FormData,
): Promise<ConvertToLiveState> {
  const [user, firm] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
  ]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };
  if (!firm.is_demo) return { ok: false, error: "already_live" };

  const admin = getServiceRoleSupabase();

  const { error: firmErr } = await admin
    .from("firms")
    .update({ is_demo: false })
    .eq("id", firm.id);
  if (firmErr) {
    console.error("[convert-to-live] firms.update failed:", firmErr);
    return { ok: false, error: "update_failed" };
  }

  // Unpause every engagement that currently has reminders paused.
  // We only target rows where reminders_paused = true so a manually-
  // paused engagement that the user intentionally muted gets caught
  // too — that's acceptable for a one-time "go live" action; if it
  // turns out they wanted one specific engagement to stay quiet,
  // they can re-pause it from the engagement detail page.
  const { data: unpaused, error: engErr } = await admin
    .from("engagements")
    .update({ reminders_paused: false })
    .eq("firm_id", firm.id)
    .eq("reminders_paused", true)
    .select("id");
  if (engErr) {
    // Not fatal — the firm is already live. Log + carry on so the UI
    // doesn't tell the user the whole thing failed.
    console.error("[convert-to-live] engagements.update failed:", engErr);
  }

  // Refresh every render of the in-app tree so the demo banner +
  // block modals disappear immediately.
  revalidatePath("/", "layout");
  return { ok: true, unpausedCount: unpaused?.length ?? 0 };
}
