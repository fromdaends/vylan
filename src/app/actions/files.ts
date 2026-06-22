"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { approveFile, rejectFile } from "@/lib/db/file-review";
import { deleteUploadedFilePermanently } from "@/lib/db/uploaded-files";
import { scheduleSetAssessment } from "@/lib/ai/set-assessment";
import { logUserActivity } from "@/lib/db/activity";
import { getServerSupabase } from "@/lib/supabase/server";

// Per-FILE accountant decisions from the Preview overlay. The item-level
// actions in items.ts still exist (engagement checklist) and now fan out to
// every file; these act on one file so the accountant can approve some and
// reject others under the same checklist line.

export type FileActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

// Scope a file to the caller's firm (file -> request_item -> engagement) so the
// activity log + cache revalidation target the right engagement. The write
// itself is additionally RLS-guarded: uploaded_files is firm-scoped, so a
// session client can only ever touch its own firm's files.
async function getFileContext(
  fileId: string,
): Promise<{ engagementId: string; firmId: string; itemId: string } | null> {
  const sb = await getServerSupabase();
  const { data } = await sb
    .from("uploaded_files")
    .select("request_item_id, engagement_id, engagements!inner(firm_id)")
    .eq("id", fileId)
    .maybeSingle();
  if (!data) return null;
  type Row = {
    request_item_id: string;
    engagement_id: string;
    engagements: { firm_id: string } | { firm_id: string }[] | null;
  };
  const e = (data as Row).engagements;
  const firmId = Array.isArray(e) ? e[0]?.firm_id : e?.firm_id;
  if (!firmId) return null;
  return {
    engagementId: (data as Row).engagement_id,
    firmId,
    itemId: (data as Row).request_item_id,
  };
}

// Narrow revalidation to the engagement page that changed + the dashboard
// (whose attention counts depend on item status). Routes are localized under
// /[locale], so a bare "/engagements/[id]" never matches the real
// "/fr/engagements/[id]" and would silently revalidate nothing — revalidate
// every locale's concrete path (matches the items.ts helper).
const LOCALES = ["en", "fr"] as const;
function revalidate(engagementId: string | undefined) {
  for (const loc of LOCALES) {
    if (engagementId) revalidatePath(`/${loc}/engagements/${engagementId}`);
    revalidatePath(`/${loc}/dashboard`);
  }
}

export async function approveFileAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  const ctx = await getFileContext(id);
  await approveFile(sb, id, auth.user?.id ?? null);
  if (ctx) {
    // Reuse the existing approve_item activity code (label reads fine for a
    // file too); the file_id in metadata records which document.
    await logUserActivity(ctx.firmId, ctx.engagementId, "approve_item", {
      item_id: ctx.itemId,
      file_id: id,
    });
  }
  revalidate(ctx?.engagementId);
}

// PERMANENT per-file delete (no recycle bin). The session-scoped
// getFileContext lookup is the authorization: RLS only returns the row when
// the caller belongs to the file's firm. The destructive work then runs
// service-role (uploaded_files has no authenticated DELETE policy) — storage
// object + DB row erased, duplicate pointers re-homed, item status
// recomputed, so the document also disappears from the client portal.
export async function deleteFileAction(
  formData: FormData,
): Promise<FileActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "missing_fields" };
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: "unauth" };
  const ctx = await getFileContext(id);
  if (!ctx) return { error: "not_found" };

  const result = await deleteUploadedFilePermanently(id);
  if (!result.ok) return { error: "delete_failed" };

  // The set changed — re-run the group review so its summary (and any
  // missing-page / duplicate verdict) reflects the remaining files instead of
  // going stale. Debounced + best-effort; never blocks the delete.
  if (result.itemId) await scheduleSetAssessment(result.itemId);

  // PII rule: ids only, never the filename (the log outlives the file).
  await logUserActivity(ctx.firmId, ctx.engagementId, "delete_file", {
    item_id: ctx.itemId,
    file_id: id,
  });
  revalidate(ctx.engagementId);
  return { ok: true };
}

const RejectSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(2, "min_2_chars").max(500, "too_long"),
});

export async function rejectFileAction(
  _prev: FileActionState,
  formData: FormData,
): Promise<FileActionState> {
  const parsed = RejectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  const ctx = await getFileContext(parsed.data.id);
  await rejectFile(sb, parsed.data.id, parsed.data.reason, auth.user?.id ?? null);
  if (ctx) {
    await logUserActivity(ctx.firmId, ctx.engagementId, "reject_item", {
      item_id: ctx.itemId,
      file_id: parsed.data.id,
    });
  }
  revalidate(ctx?.engagementId);
  return { ok: true };
}
