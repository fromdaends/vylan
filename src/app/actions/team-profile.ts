"use server";

// Recording what a teammate does and how much of a week they have.
//
// Kept out of team.ts on purpose: that file is the roster's lifecycle — invite,
// deactivate, hand over, change rank — and every write in it is consequential.
// This is two descriptive fields, and mixing them in would put a job title next
// to "remove this person from the firm" in the same review.
//
// The gate is team.manage, which is owner-only today. Not because a job title
// is sensitive, but because every roster write in this app goes through the
// service-role client (bypassing RLS), so an application check is the only gate
// there is — and inventing a second, looser one for these two columns would be
// a permissions decision wearing a convenience's clothes.
//
// This file exports async functions ONLY. A "use server" module that exports a
// constant compiles fine and then fails the production build with an error that
// names the wrong thing.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export type SaveProfileResult = {
  ok: boolean;
  /** Set when migration 1190 has not been applied yet. */
  needsMigration?: boolean;
  error?: "no_session" | "not_allowed" | "not_found" | "bad_hours" | "save_failed";
};

// A week has 168 hours. Anything outside that is a typo, and a typo in the
// denominator of every future workload figure is worth refusing rather than
// storing. Matches the database's own check constraint.
function parseHours(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false };
  if (n <= 0 || n > 168) return { ok: false };
  // Two decimals — a 22.5-hour contract is as common as a 20-hour one, and
  // rounding somebody's week is how a capacity figure stops being trusted.
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export async function saveTeammateProfileAction(input: {
  userId: string;
  jobTitle: string | null;
  weeklyHours: string | number | null;
}): Promise<SaveProfileResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!can(user, "team.manage")) return { ok: false, error: "not_allowed" };

  const hours = parseHours(input.weeklyHours);
  if (!hours.ok) return { ok: false, error: "bad_hours" };

  const title = input.jobTitle?.trim() ? input.jobTitle.trim().slice(0, 120) : null;

  const admin = getServiceRoleSupabase();

  // The target must be in the caller's own firm. The service-role client does
  // not enforce that for us, which is exactly why it is checked here.
  const { data: target } = await admin
    .from("users")
    .select("id, firm_id")
    .eq("id", input.userId)
    .maybeSingle();
  if (!target || target.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  const { error } = await admin
    .from("users")
    .update({ job_title: title, weekly_hours: hours.value })
    .eq("id", input.userId);
  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[team profile] save failed:", error);
    return { ok: false, error: "save_failed" };
  }

  try {
    await logUserActivity(firm.id, null, "update_teammate_profile", {
      user_id: input.userId,
      job_title: title,
      weekly_hours: hours.value,
    });
  } catch (err) {
    // Already saved. An audit-log failure must not report it as failed.
    console.error("[team profile] audit log failed (profile saved):", err);
  }

  revalidateAllLocales(`/settings/team/${input.userId}`);
  revalidateAllLocales("/settings/team");
  return { ok: true };
}
