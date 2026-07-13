"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getEngagement,
  setEngagementInvoiceLock,
} from "@/lib/db/engagements";
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
  const liveInvoice =
    invoice && invoice.status !== "paid" && invoice.status !== "canceled"
      ? invoice
      : null;

  if (liveInvoice) {
    // Normal case: override the invoice's lock so the client can download.
    const ok = await setPaymentRequestOverrideUnlocked(liveInvoice.id);
    if (!ok) return;
    await logUserActivity(firm.id, engagementId, "invoice_unlocked", {
      payment_request_id: liveInvoice.id,
    });
    revalidatePath(`/engagements/${engagementId}`);
    return;
  }

  // No live invoice row yet, but the finished work is still fallback-locked by the
  // engagement's lock preference (a deferred invoice that hasn't been created, or
  // one that failed to send). "Override always available" — clear the preference
  // so the client can download. A later invoice is created without the lock.
  const engagement = await getEngagement(engagementId);
  if (
    !engagement ||
    engagement.firm_id !== firm.id ||
    engagement.invoice_locks_deliverables !== true
  ) {
    return;
  }
  const ok = await setEngagementInvoiceLock(engagementId, false);
  if (!ok) return;
  await logUserActivity(firm.id, engagementId, "invoice_unlocked", {
    via: "engagement_preference",
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
