"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";

export type OverrideState =
  | { ok: true }
  | { ok: false; error: string };

const OverrideSchema = z.object({
  file_id: z.string().uuid("invalid_file_id"),
  reason: z.string().max(500).optional(),
});

// Server action wired to the "AI was wrong" button (Phase 5 UI).
// Verifies the caller's firm owns the file, then runs the pure
// override flow on the service-role client (so the activity log +
// override row inserts even if RLS is being strict on
// request_items.approved_by).
export async function overrideAiRejection(
  _prev: OverrideState | null,
  formData: FormData,
): Promise<OverrideState> {
  const parsed = OverrideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const session = await getServerSupabase();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { ok: false, error: "no_session" };

  const [user, firm] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
  ]);
  if (!user || !firm) return { ok: false, error: "no_session" };

  // Verify the file is owned by the caller's firm (via the file's
  // engagement). A different-firm member should never be able to
  // touch our files — RLS would refuse the read here.
  const { data: file } = await session
    .from("uploaded_files")
    .select(
      "id, request_item_id, engagement_id, ai_usability, engagements!inner(firm_id)",
    )
    .eq("id", parsed.data.file_id)
    .maybeSingle();
  if (!file) return { ok: false, error: "file_not_found" };

  type FileRow = {
    request_item_id: string;
    engagement_id: string;
    ai_usability: { primary_issue?: string | null } | null;
    engagements: { firm_id: string } | { firm_id: string }[];
  };
  const fRow = file as unknown as FileRow;
  const fileFirmId = Array.isArray(fRow.engagements)
    ? fRow.engagements[0]?.firm_id
    : fRow.engagements.firm_id;
  if (fileFirmId !== firm.id) return { ok: false, error: "forbidden" };

  // All checks passed — run the override on the service-role client
  // so we can write activity_log + the override row regardless of
  // narrower RLS policies.
  const admin = getServiceRoleSupabase();
  await applyOverride(admin, {
    fileId: parsed.data.file_id,
    requestItemId: fRow.request_item_id,
    engagementId: fRow.engagement_id,
    firmId: firm.id,
    overriddenByUserId: user.id,
    originalIssue: fRow.ai_usability?.primary_issue ?? null,
    overrideReason: parsed.data.reason ?? null,
  });

  // Refresh engagement detail + dashboard so the new state shows up.
  revalidatePath("/", "layout");
  return { ok: true };
}

// Pure-ish helper that does only the DB writes. Lifted out so the
// unit test can drive it with a mock supabase client without the
// auth / session plumbing.
export async function applyOverride(
  supabase: SupabaseClient,
  opts: {
    fileId: string;
    requestItemId: string;
    engagementId: string;
    firmId: string;
    overriddenByUserId: string;
    originalIssue: string | null;
    overrideReason: string | null;
  },
): Promise<void> {
  // 1. File: clear the auto-rejection flag.
  await supabase
    .from("uploaded_files")
    .update({ ai_rejected: false })
    .eq("id", opts.fileId);

  // 2. Override audit row — learning signal for prompt-tuning.
  await supabase.from("ai_rejection_overrides").insert({
    file_id: opts.fileId,
    overridden_by_user_id: opts.overriddenByUserId,
    original_issue: opts.originalIssue,
    override_reason: opts.overrideReason,
  });

  // 3. Decrement the strike counter (clamped at 0). We read-modify-
  // write because the counter is also touched by the auto-reject
  // path; doing it as a single UPDATE … SET count = greatest(0,
  // count-1) needs raw SQL which the SDK doesn't model nicely.
  const { data: itemRow } = await supabase
    .from("request_items")
    .select("ai_rejection_count")
    .eq("id", opts.requestItemId)
    .single();
  const current = Number(itemRow?.ai_rejection_count ?? 0);
  const next = Math.max(0, current - 1);

  // 4. Item: approve it (the whole point of the override) AND drop
  // the counter, in one update.
  await supabase
    .from("request_items")
    .update({
      status: "approved",
      ai_rejection_count: next,
      approved_by: opts.overriddenByUserId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", opts.requestItemId);

  // 5. Activity log entry.
  await supabase.from("activity_log").insert({
    firm_id: opts.firmId,
    engagement_id: opts.engagementId,
    actor_type: "user",
    actor_id: opts.overriddenByUserId,
    action: "ai_rejection_overridden",
    metadata: {
      uploaded_file_id: opts.fileId,
      request_item_id: opts.requestItemId,
      original_issue: opts.originalIssue,
      override_reason: opts.overrideReason,
    },
  });
}
