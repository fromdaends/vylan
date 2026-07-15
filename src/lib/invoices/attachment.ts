import { nanoid } from "nanoid";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getEngagement } from "@/lib/db/engagements";
import {
  createFinalDocument,
  deleteFinalDocument,
} from "@/lib/db/final-documents";
import {
  invoiceAttachmentPath,
  isAllowedMime,
  MAX_BYTES,
  removeObjectQuiet,
  truncateFilename,
  uploadObject,
} from "@/lib/storage";

export type StoredInvoiceAttachment = {
  storagePath: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  content: Buffer;
  documentId: string;
};

export type StoreInvoiceAttachmentResult =
  | { ok: true; attachment: StoredInvoiceAttachment }
  | {
      ok: false;
      error:
        | "attachment_too_large"
        | "attachment_type"
        | "attachment_upload"
        | "not_found";
    };

export function validateInvoiceAttachment(file: File):
  | { ok: true }
  | { ok: false; error: "attachment_too_large" | "attachment_type" } {
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "attachment_too_large" };
  }
  if (!isAllowedMime(file.type)) {
    return { ok: false, error: "attachment_type" };
  }
  return { ok: true };
}

// Store an invoice document before its invoice is sent. Keeping the object in
// final_documents makes it available to both the client portal and a delayed
// invoice worker without putting file bytes into a scheduled-job payload.
export async function storeInvoiceAttachment(
  engagementId: string,
  file: File,
): Promise<StoreInvoiceAttachmentResult> {
  const validation = validateInvoiceAttachment(file);
  if (!validation.ok) return validation;

  const [firm, user, engagement] = await Promise.all([
    getCurrentFirm(),
    getCurrentUser(),
    getEngagement(engagementId),
  ]);
  if (!firm || !user || !engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  const filename = truncateFilename(file.name || "invoice.pdf");
  const storagePath = invoiceAttachmentPath({
    firmId: firm.id,
    engagementId,
    uuid: nanoid(12),
    filename,
  });
  const content = Buffer.from(await file.arrayBuffer());
  try {
    await uploadObject({
      path: storagePath,
      body: content,
      contentType: file.type || "application/octet-stream",
    });
  } catch (error) {
    console.error("[invoices] invoice attachment upload failed:", error);
    return { ok: false, error: "attachment_upload" };
  }

  const document = await createFinalDocument({
    firm_id: firm.id,
    engagement_id: engagementId,
    storage_path: storagePath,
    original_filename: filename,
    display_name: filename,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by_user_id: user.id,
  });
  if (!document) {
    await removeObjectQuiet(storagePath);
    return { ok: false, error: "attachment_upload" };
  }

  return {
    ok: true,
    attachment: {
      storagePath,
      filename,
      mimeType: file.type || null,
      sizeBytes: file.size,
      content,
      documentId: document.id,
    },
  };
}

export async function removeStoredInvoiceAttachment(
  attachment: Pick<StoredInvoiceAttachment, "documentId" | "storagePath">,
): Promise<void> {
  await deleteFinalDocument(attachment.documentId);
  await removeObjectQuiet(attachment.storagePath);
}
