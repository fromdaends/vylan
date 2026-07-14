"use server";

import { z } from "zod";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { createInvoiceForEngagement } from "@/lib/invoices/create";
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

export type RequestPaymentInput = {
  engagementId: string;
  amountCents: number;
  description?: string;
  delivery: "portal" | "email" | "both";
  // Gate the engagement's Final documents until this invoice is paid.
  locksDeliverables?: boolean;
};

export type RequestPaymentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// $0.50 Stripe minimum up to ~$1M, in integer cents — no floats.
const Schema = z.object({
  engagementId: z.string().regex(UUID_RE, "invalid_id"),
  amountCents: z.number().int("invalid_amount").min(50, "amount_too_small").max(99_999_999, "amount_too_large"),
  description: z.string().trim().max(500, "too_long").optional(),
  delivery: z.enum(["portal", "email", "both"]),
  locksDeliverables: z.boolean().optional(),
});

// Create the engagement's invoice (a payment_request). Shares the one create
// path with the "create it now" option on the New engagement page
// (createInvoiceForEngagement): same money rail, same portal "Pay now" email,
// and the same "one invoice per engagement" rule.
export async function requestPaymentAction(
  input: RequestPaymentInput,
): Promise<RequestPaymentResult> {
  return createPaymentRequestWithOptionalAttachment(input, null);
}

// FormData entry point used by the Invoice dialog when an accountant attaches
// the actual invoice PDF/image. The existing object action stays unchanged for
// every caller that does not need a file.
export async function requestPaymentWithAttachmentAction(
  formData: FormData,
): Promise<RequestPaymentResult> {
  const fileValue = formData.get("attachment");
  const attachment = fileValue instanceof File && fileValue.size > 0
    ? fileValue
    : null;
  return createPaymentRequestWithOptionalAttachment(
    {
      engagementId: String(formData.get("engagement_id") ?? ""),
      amountCents: Number(formData.get("amount_cents")),
      description: String(formData.get("description") ?? "") || undefined,
      delivery: "both",
      locksDeliverables: formData.get("locks_deliverables") === "true",
    },
    attachment,
  );
}

async function createPaymentRequestWithOptionalAttachment(
  input: RequestPaymentInput,
  attachmentFile: File | null,
): Promise<RequestPaymentResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }

  let attachment:
    | {
        storagePath: string;
        filename: string;
        mimeType: string | null;
        sizeBytes: number;
        content: Buffer;
        documentId: string;
      }
    | undefined;
  if (attachmentFile) {
    if (attachmentFile.size > MAX_BYTES) {
      return { ok: false, error: "attachment_too_large" };
    }
    if (!isAllowedMime(attachmentFile.type)) {
      return { ok: false, error: "attachment_type" };
    }
    const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
    const engagement = await getEngagement(parsed.data.engagementId);
    if (!firm || !user || !engagement || engagement.firm_id !== firm.id) {
      return { ok: false, error: "not_found" };
    }
    const filename = truncateFilename(attachmentFile.name || "invoice.pdf");
    const storagePath = invoiceAttachmentPath({
      firmId: firm.id,
      engagementId: engagement.id,
      uuid: nanoid(12),
      filename,
    });
    const content = Buffer.from(await attachmentFile.arrayBuffer());
    try {
      await uploadObject({
        path: storagePath,
        body: content,
        contentType: attachmentFile.type || "application/octet-stream",
      });
    } catch (error) {
      console.error("[payments] invoice attachment upload failed:", error);
      return { ok: false, error: "attachment_upload" };
    }
    const document = await createFinalDocument({
      firm_id: firm.id,
      engagement_id: engagement.id,
      storage_path: storagePath,
      original_filename: filename,
      display_name: filename,
      mime_type: attachmentFile.type || null,
      size_bytes: attachmentFile.size,
      uploaded_by_user_id: user.id,
    });
    if (!document) {
      await removeObjectQuiet(storagePath);
      return { ok: false, error: "attachment_upload" };
    }
    attachment = {
      storagePath,
      filename,
      mimeType: attachmentFile.type || null,
      sizeBytes: attachmentFile.size,
      content,
      documentId: document.id,
    };
  }

  const res = await createInvoiceForEngagement({
    engagementId: parsed.data.engagementId,
    amountCents: parsed.data.amountCents,
    description: parsed.data.description,
    delivery: parsed.data.delivery,
    locksDeliverables: parsed.data.locksDeliverables,
    attachment,
  });
  if (!res.ok) {
    if (attachment) {
      await deleteFinalDocument(attachment.documentId);
      await removeObjectQuiet(attachment.storagePath);
    }
    // Map the helper's reason to a stable error string the dialog translates.
    const error =
      res.reason === "invalid_amount" ? "amount_too_small" : res.reason;
    return { ok: false, error };
  }

  revalidatePath(`/engagements/${parsed.data.engagementId}`);
  return { ok: true, id: res.id };
}
