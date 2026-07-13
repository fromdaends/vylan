"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getLatestPaymentRequestForEngagement,
  setPaymentRequestOverrideUnlocked,
  cancelPaymentRequest,
} from "@/lib/db/payment-requests";
import { logUserActivity } from "@/lib/db/activity";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The accountant's manual "unlock without payment": the client can download the
// Final documents even though the invoice is still unpaid (comped, paid by
// cheque, etc.). The invoice stays open/owed; only the deliverables lock is
// lifted. Firm-scoped via RLS.
export async function unlockDeliverablesAction(formData: FormData) {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return;
  const engagementId = formData.get("engagement_id");
  if (typeof engagementId !== "string" || !UUID_RE.test(engagementId)) return;

  const invoice = await getLatestPaymentRequestForEngagement(engagementId);
  // Only meaningful on a live (unpaid) invoice.
  if (!invoice || invoice.status === "paid" || invoice.status === "canceled") {
    return;
  }
  const ok = await setPaymentRequestOverrideUnlocked(invoice.id);
  if (!ok) return;

  await logUserActivity(firm.id, engagementId, "invoice_unlocked", {
    payment_request_id: invoice.id,
  });
  revalidatePath(`/engagements/${engagementId}`);
}

// The accountant "waive invoice": cancel the invoice entirely (nothing owed).
// This also unlocks the deliverables (the lock only applies while owed).
export async function waiveInvoiceAction(formData: FormData) {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return;
  const engagementId = formData.get("engagement_id");
  if (typeof engagementId !== "string" || !UUID_RE.test(engagementId)) return;

  const invoice = await getLatestPaymentRequestForEngagement(engagementId);
  if (!invoice || invoice.status === "paid" || invoice.status === "canceled") {
    return;
  }
  const ok = await cancelPaymentRequest(invoice.id);
  if (!ok) return;

  await logUserActivity(firm.id, engagementId, "invoice_waived", {
    payment_request_id: invoice.id,
    amount_cents: invoice.amount_cents,
  });
  revalidatePath(`/engagements/${engagementId}`);
}
