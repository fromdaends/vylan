"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createInvoiceForEngagement } from "@/lib/invoices/create";
import {
  removeStoredInvoiceAttachment,
  storeInvoiceAttachment,
  type StoredInvoiceAttachment,
} from "@/lib/invoices/attachment";

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

  let attachment: StoredInvoiceAttachment | undefined;
  if (attachmentFile) {
    const stored = await storeInvoiceAttachment(
      parsed.data.engagementId,
      attachmentFile,
    );
    if (!stored.ok) return { ok: false, error: stored.error };
    attachment = stored.attachment;
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
      await removeStoredInvoiceAttachment(attachment);
    }
    // Map the helper's reason to a stable error string the dialog translates.
    const error =
      res.reason === "invalid_amount" ? "amount_too_small" : res.reason;
    return { ok: false, error };
  }

  revalidatePath(`/engagements/${parsed.data.engagementId}`);
  return { ok: true, id: res.id };
}
