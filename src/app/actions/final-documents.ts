"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getEngagement } from "@/lib/db/engagements";
import {
  createFinalDocument,
  deleteFinalDocument,
} from "@/lib/db/final-documents";
import { logUserActivity } from "@/lib/db/activity";
import {
  uploadObject,
  removeObjectQuiet,
  finalDocPath,
  truncateFilename,
  isAllowedMime,
  MAX_BYTES,
} from "@/lib/storage";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FinalDocumentActionState = { ok?: boolean; error?: string } | null;

// Upload a completed deliverable (final document) for an engagement, to return to
// the client. Reuses the same private bucket as everything else; the object is
// written service-role (the bucket has no authenticated write policy) and the row
// is inserted through the RLS session so the firm scoping is enforced by the
// with-check policy. Best-effort activity log. Never gated by the invoice lock —
// the lock only affects the CLIENT's download, never the accountant's upload.
export async function uploadFinalDocumentAction(
  _prev: FinalDocumentActionState,
  formData: FormData,
): Promise<FinalDocumentActionState> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "unauthenticated" };

  const engagementId = formData.get("engagement_id");
  const file = formData.get("file");
  const rawNote = formData.get("note");
  if (typeof engagementId !== "string" || !UUID_RE.test(engagementId)) {
    return { error: "invalid" };
  }
  if (!(file instanceof File) || file.size === 0) return { error: "file" };
  if (file.size > MAX_BYTES) return { error: "file_too_large" };
  if (!isAllowedMime(file.type)) return { error: "file_type" };
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > 1000) return { error: "note_too_long" };

  // The engagement must belong to this firm (RLS-scoped read + explicit check).
  const engagement = await getEngagement(engagementId);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { error: "not_found" };
  }
  // Never deliver into a cancelled engagement (its portal is closed).
  if (engagement.status === "cancelled") return { error: "not_found" };

  const originalFilename = truncateFilename(file.name || "document");
  const path = finalDocPath({
    firmId: firm.id,
    engagementId,
    uuid: nanoid(12),
    filename: originalFilename,
  });

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadObject({
      path,
      body: bytes,
      contentType: file.type || "application/octet-stream",
      metadata: note ? { clientNote: note } : undefined,
    });
  } catch (e) {
    console.error("[final-documents] upload object failed:", e);
    return { error: "generic" };
  }

  const row = await createFinalDocument({
    firm_id: firm.id,
    engagement_id: engagementId,
    storage_path: path,
    original_filename: originalFilename,
    display_name: null,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by_user_id: user.id,
  });
  if (!row) {
    // Row insert failed — clean up the object we just wrote so nothing dangles.
    await removeObjectQuiet(path);
    return { error: "generic" };
  }

  await logUserActivity(firm.id, engagementId, "final_document_uploaded", {
    final_document_id: row.id,
    filename: originalFilename,
  });

  revalidatePath(`/engagements/${engagementId}`);
  return { ok: true };
}

// Delete a final document (accountant only, RLS-scoped). Removes the row and the
// underlying object. The hidden engagement_id drives revalidation/logging.
export async function deleteFinalDocumentAction(formData: FormData) {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return;

  const id = formData.get("id");
  const engagementId = formData.get("engagement_id");
  if (typeof id !== "string" || !UUID_RE.test(id)) return;

  const deleted = await deleteFinalDocument(id);
  if (!deleted) return; // not found / not this firm (RLS)

  await removeObjectQuiet(deleted.storage_path);

  if (typeof engagementId === "string" && UUID_RE.test(engagementId)) {
    await logUserActivity(firm.id, engagementId, "final_document_removed", {
      final_document_id: id,
    });
    revalidatePath(`/engagements/${engagementId}`);
  }
}
