import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import type { UsabilityVerdict } from "@/lib/ai/usability";
import { recomputeItemStatus } from "@/lib/db/file-review";
import { BUCKET } from "@/lib/storage";

// Minimal service-role fetch of ONE file's storage location + type + name — used
// to attach the source receipt to the posted QuickBooks transaction. Returns null
// when the file (or its storage path) is missing. Prefers the AI-cleaned
// display_name for the attachment's QuickBooks filename.
export async function getUploadedFileById(fileId: string): Promise<{
  storagePath: string;
  mimeType: string;
  fileName: string;
} | null> {
  const sb = getServiceRoleSupabase();
  const { data } = await sb
    .from("uploaded_files")
    .select("storage_path, mime_type, original_filename, display_name")
    .eq("id", fileId)
    .maybeSingle();
  if (!data?.storage_path) return null;
  return {
    storagePath: data.storage_path as string,
    mimeType: (data.mime_type as string | null) ?? "",
    fileName:
      (data.display_name as string | null) ??
      (data.original_filename as string | null) ??
      "receipt",
  };
}

export type UploadedFile = {
  id: string;
  request_item_id: string;
  engagement_id: string;
  storage_path: string;
  original_filename: string;
  // Clean, AI-generated name (e.g. "T4 - 2024 - Hydro-Quebec.pdf") set by the
  // classify worker once it confidently recognises the document. NULL = AI
  // unsure / not yet classified → callers fall back to original_filename
  // (`display_name ?? original_filename`). Accountant-facing only; the client
  // portal always shows original_filename. Migration 0280.
  display_name: string | null;
  mime_type: string;
  size_bytes: number;
  ai_classification: string | null;
  ai_confidence: number | null;
  ai_extracted_fields: Record<string, unknown> | null;
  // Phase 1+2: structured AI usability verdict (null until classified
  // or when the model output was malformed).
  ai_usability: UsabilityVerdict | null;
  // Phase 3: true if the system actually auto-rejected this upload.
  // (Even when true, the file stays in storage — accountants can
  // override via Phase 5's UI.)
  ai_rejected: boolean;
  // Per-file accountant review (migration 0240). Each file carries its OWN
  // decision; the parent item's status is a roll-up of these (deriveItemStatus).
  review_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_at: string;
  // Duplicate detection (migration 0270). content_hash is the SHA-256 of the
  // stored bytes; is_duplicate marks an exact-content re-upload; the earlier
  // file it duplicates is duplicate_of_file_id. A duplicate is ignored by the
  // item-status roll-up (deriveItemStatus) and hidden from the client portal.
  content_hash: string | null;
  is_duplicate: boolean;
  duplicate_of_file_id: string | null;
};

export async function listUploadedFilesForEngagement(
  engagement_id: string,
): Promise<UploadedFile[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("engagement_id", engagement_id)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UploadedFile[];
}

// PERMANENTLY delete one uploaded document: the storage object and the DB row
// are erased outright — no soft-delete, no recycle bin (deliberate: this is
// the accountant's "this should not exist" control, and the client portal
// reads the same rows, so the file vanishes there too on its next render).
// Service-role: the caller (server action) verifies firm membership first via
// the session client; uploaded_files has no authenticated DELETE policy.
//
// Duplicate bookkeeping: if other files were marked as duplicates OF this one,
// the oldest of them is PROMOTED to be the real copy (the bytes are identical
// by definition) — un-flagged, and un-rejected when the system (not an
// accountant) had auto-rejected it as a duplicate. Remaining duplicates are
// re-pointed at the promoted file. Without this, deleting an original would
// leave its copies set aside forever and the checklist item would wrongly
// read as still waiting.
export async function deleteUploadedFilePermanently(fileId: string): Promise<{
  ok: boolean;
  engagementId?: string;
  itemId?: string;
}> {
  const sb = getServiceRoleSupabase();
  const { data: row } = await sb
    .from("uploaded_files")
    .select("id, storage_path, request_item_id, engagement_id")
    .eq("id", fileId)
    .maybeSingle();
  if (!row) return { ok: false };

  // Files marked as duplicates of the one being deleted, oldest first.
  const { data: dependents } = await sb
    .from("uploaded_files")
    .select("id, request_item_id, review_status, reviewed_by")
    .eq("duplicate_of_file_id", fileId)
    .order("uploaded_at", { ascending: true });

  const itemsToRecompute = new Set<string>([row.request_item_id]);

  if (dependents && dependents.length > 0) {
    const promoted = dependents[0];
    const promotedPatch: Record<string, unknown> = {
      is_duplicate: false,
      duplicate_of_file_id: null,
    };
    // A SYSTEM duplicate-reject (reviewed_by null) loses its basis once the
    // original is gone — reopen the copy. An ACCOUNTANT's own rejection is a
    // human decision and stays.
    if (promoted.review_status === "rejected" && promoted.reviewed_by == null) {
      promotedPatch.review_status = "pending";
      promotedPatch.rejection_reason = null;
      promotedPatch.reviewed_at = null;
    }
    await sb.from("uploaded_files").update(promotedPatch).eq("id", promoted.id);
    itemsToRecompute.add(promoted.request_item_id);

    const rest = dependents.slice(1).map((d) => d.id);
    if (rest.length > 0) {
      await sb
        .from("uploaded_files")
        .update({ duplicate_of_file_id: promoted.id })
        .in("id", rest);
    }
  }

  // Storage first, best-effort: a missing object must not block erasing the
  // row (the row is what the product reads).
  try {
    await sb.storage.from(BUCKET).remove([row.storage_path]);
  } catch (e) {
    console.warn("[files] storage delete failed for", row.storage_path, e);
  }

  const { error: delErr } = await sb
    .from("uploaded_files")
    .delete()
    .eq("id", fileId);
  if (delErr) {
    console.error("[files] row delete failed:", delErr);
    return { ok: false };
  }

  for (const itemId of itemsToRecompute) {
    await recomputeItemStatus(sb, itemId);
  }

  return {
    ok: true,
    engagementId: row.engagement_id,
    itemId: row.request_item_id,
  };
}

export async function signedDownloadUrl(
  storage_path: string,
  ttlSec = 900,
): Promise<string> {
  // Service role: the bucket is private and accountant downloads happen
  // server-side via this signed URL. RLS-wise the accountant already proved
  // firm membership to reach this code path.
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage
    .from("client-uploads")
    .createSignedUrl(storage_path, ttlSec);
  if (error || !data) throw error ?? new Error("signed_url_failed");
  return data.signedUrl;
}

// Batched variant: ONE storage round-trip to sign many paths at once. The
// engagement detail page pre-signs every upload, and doing that as N separate
// calls was a real chunk of its load time. Returns a path -> URL map; fail-soft
// (a path that errors or is missing just isn't in the map — callers fall back).
export async function signedDownloadUrls(
  storage_paths: string[],
  ttlSec = 900,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (storage_paths.length === 0) return out;
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.storage
    .from("client-uploads")
    .createSignedUrls(storage_paths, ttlSec);
  if (error || !data) return out;
  for (const row of data) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}
