"use server";

import { revalidatePath } from "next/cache";
import { approveFile } from "@/lib/db/file-review";
import { deleteUploadedFilePermanently } from "@/lib/db/uploaded-files";
import { scheduleSetAssessment } from "@/lib/ai/set-assessment";
import { logUserActivity } from "@/lib/db/activity";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getFiledCopyForFile,
  getFirmStorageConnection,
} from "@/lib/db/filing";
import { removeFiledCopy } from "@/lib/filing/remove";

// Per-FILE accountant decisions from the Preview overlay. The item-level
// actions in items.ts still exist (engagement checklist) and now fan out to
// every file; these act on one file so the accountant can approve some and
// reject others under the same checklist line.

export type FileActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  // Outcome of the optional "also remove the filed copy" step.
  storageCopy?: "trashed" | "already_gone" | "failed";
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
// Does this document have a copy Vylan FILED to the firm's storage (on the
// active connection)? Drives the delete dialog's "also remove from
// {provider}" question. The RLS-scoped context lookup is the authorization.
export async function getFiledCopyInfoAction(
  source: "checklist" | "final",
  fileId: string,
): Promise<{ filed: boolean; provider: "google_drive" | "microsoft" | null }> {
  const firm = await getCurrentFirm();
  if (!firm || typeof fileId !== "string" || !fileId) {
    return { filed: false, provider: null };
  }
  if (source === "checklist") {
    const ctx = await getFileContext(fileId);
    if (!ctx || ctx.firmId !== firm.id) return { filed: false, provider: null };
  } else {
    const sb = await getServerSupabase();
    const { data } = await sb
      .from("final_documents")
      .select("id")
      .eq("id", fileId)
      .maybeSingle();
    if (!data) return { filed: false, provider: null };
  }
  const copy = await getFiledCopyForFile(firm.id, source, fileId);
  if (!copy) return { filed: false, provider: null };
  // Provider name for the dialog label (RLS display read).
  const connection = await getFirmStorageConnection();
  const provider =
    connection?.id === copy.connectionId &&
    (connection.provider === "google_drive" ||
      connection.provider === "microsoft")
      ? connection.provider
      : null;
  return { filed: provider !== null, provider };
}

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

  // Founder decision (2026-07-27): the delete dialog may also ask to remove
  // the copy Vylan FILED to the firm's storage. Runs BEFORE the row delete
  // (the ledger lookup wants the live context) but never blocks it — the
  // Vylan delete is the primary intent; the storage outcome is reported.
  let storageCopy: "trashed" | "already_gone" | "failed" | undefined;
  if (formData.get("remove_filed_copy") === "1") {
    const removed = await removeFiledCopy({
      firmId: ctx.firmId,
      userId: auth.user.id,
      source: "checklist",
      fileId: id,
    });
    if (removed.ok) storageCopy = removed.outcome;
    else if (removed.reason !== "not_filed") storageCopy = "failed";
  }

  const result = await deleteUploadedFilePermanently(id);
  if (!result.ok) return { error: "delete_failed", storageCopy };

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
  return { ok: true, storageCopy };
}

// Per-file reject moved to the stable URL endpoint POST /api/files/[id]/reject
// (deploy-skew-proof). Both the RejectModal and the Preview overlay call it now.
