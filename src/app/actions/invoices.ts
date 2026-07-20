"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getEngagement,
  setEngagementInvoiceLock,
  updateEngagementInvoiceAutomation,
} from "@/lib/db/engagements";
import {
  getLatestPaymentRequestForEngagement,
  setPaymentRequestOverrideUnlocked,
  relockPaymentRequestDeliverables,
  updatePaymentRequestAmountDescription,
  updateGeneratedInvoiceFields,
  cancelPaymentRequest,
} from "@/lib/db/payment-requests";
import { getFirmInvoiceSettings } from "@/lib/db/invoice-settings";
import {
  computeInvoiceTotals,
  normalizeLineItems,
  MIN_TOTAL_CENTS,
  MAX_TOTAL_CENTS,
} from "@/lib/invoices/totals";
import { isTaxComponentId, type TaxComponentId } from "@/lib/tax/canada";
import { expireOpenStripeCheckout } from "@/lib/payments/close-other-rail";
import { logUserActivity } from "@/lib/db/activity";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  cancelScheduledInvoice,
  dispatchInvoiceOnCompletion,
} from "@/lib/invoices/schedule";
import {
  removeStoredInvoiceAttachment,
  storeInvoiceAttachment,
  type StoredInvoiceAttachment,
} from "@/lib/invoices/attachment";

export type InvoiceEditResult = { ok: true } | { ok: false; error: string };
export type InvoiceAutomationEditResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "invalid"
        | "not_found"
        | "already_invoiced"
        | "save_failed"
        | "attachment_too_large"
        | "attachment_type"
        | "attachment_upload";
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every action in this file changes something the stage resolver reads: whether
// an invoice is owed, and whether the deliverables lock is holding the finished
// work back from the client. Both feed "final documents released", so unlocking
// a paid-by-cheque engagement can complete it outright, and re-locking pulls it
// back to awaiting_payment. Re-resolve after each, then revalidate.
async function syncStageAndRevalidate(engagementId: string): Promise<void> {
  await syncEngagementStage(await getServerSupabase(), engagementId);
  revalidatePath(`/engagements/${engagementId}`);
}

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
    await syncStageAndRevalidate(engagementId);
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
  await syncStageAndRevalidate(engagementId);
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
  // Also clear the engagement lock preference so a waived invoice fully unlocks
  // (otherwise the fallback would keep the finals labelled "locked").
  await setEngagementInvoiceLock(engagementId, false);

  await logUserActivity(firm.id, engagementId, "invoice_waived", {
    payment_request_id: invoice.id,
    amount_cents: invoice.amount_cents,
  });
  await syncStageAndRevalidate(engagementId);
}

// Re-lock the deliverables after an unlock (or lock an invoice created without
// it). Sets the invoice's lock + clears the override, and (re)sets the engagement
// preference so the fallback locks and a later deferred invoice carries it.
export async function relockDeliverablesAction(formData: FormData) {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return;
  const engagementId = formData.get("engagement_id");
  if (typeof engagementId !== "string" || !UUID_RE.test(engagementId)) return;

  const engagement = await getEngagement(engagementId);
  if (!engagement || engagement.firm_id !== firm.id) return;

  const invoice = await getLatestPaymentRequestForEngagement(engagementId);
  // A settled (paid) invoice can't be re-locked — it's paid for.
  if (invoice && invoice.status === "paid") return;
  const liveInvoice =
    invoice && invoice.status !== "canceled" ? invoice : null;

  if (liveInvoice) {
    const ok = await relockPaymentRequestDeliverables(liveInvoice.id);
    if (!ok) return;
  }
  await setEngagementInvoiceLock(engagementId, true);

  await logUserActivity(firm.id, engagementId, "invoice_relocked", {
    payment_request_id: liveInvoice?.id ?? null,
  });
  await syncStageAndRevalidate(engagementId);
}

// Edit an unpaid invoice's amount + description. Returns a result so the dialog
// can surface a validation error.
export async function editInvoiceAction(input: {
  engagementId: string;
  amountCents: number;
  description?: string;
}): Promise<InvoiceEditResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "unauthenticated" };
  if (!UUID_RE.test(input.engagementId)) {
    return { ok: false, error: "invalid" };
  }
  const cents = input.amountCents;
  if (!Number.isInteger(cents) || cents < 50 || cents > 99_999_999) {
    return { ok: false, error: "amount" };
  }
  // Firm ownership check (defense in depth, parity with relock), on top of RLS.
  const engagement = await getEngagement(input.engagementId);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "no_invoice" };
  }

  const invoice = await getLatestPaymentRequestForEngagement(input.engagementId);
  if (!invoice || invoice.status === "paid" || invoice.status === "canceled") {
    return { ok: false, error: "no_invoice" };
  }
  // A generated invoice's amount is DERIVED from its line items — the flat
  // amount editor must never touch one, or the stored breakdown and the
  // charged total would drift apart. The dialog routes generated invoices to
  // editGeneratedInvoiceAction; this guard covers a stale client.
  if (invoice.invoice_kind === "generated") {
    return { ok: false, error: "no_invoice" };
  }
  const description = input.description?.trim() ? input.description.trim() : null;
  const ok = await updatePaymentRequestAmountDescription(
    invoice.id,
    cents,
    description,
  );
  if (!ok) return { ok: false, error: "save_failed" };

  // An open Stripe Checkout still charges the PRE-edit amount (the session's
  // price is frozen at creation). Expire it so the client's next "Pay" opens a
  // fresh session at the new total. Best-effort: an expire failure only means
  // the old window stays open, exactly as before this feature.
  if (invoice.stripe_checkout_session_id) {
    await expireOpenStripeCheckout(firm.id, invoice.stripe_checkout_session_id);
  }

  await logUserActivity(firm.id, input.engagementId, "invoice_edited", {
    payment_request_id: invoice.id,
    amount_cents: cents,
  });
  revalidatePath(`/engagements/${input.engagementId}`);
  return { ok: true };
}

// Edit an unpaid GENERATED invoice: replace lines / taxes / dates / terms and
// recompute every total server-side (the same pure lib as creation, so the
// builder preview, the stored row, and the charged amount stay identical).
// The invoice number is frozen at creation and never changes here.
export type EditGeneratedInvoiceInput = {
  engagementId: string;
  lineItems: unknown;
  taxesEnabled: boolean;
  enabledComponents: unknown;
  dueDate?: string | null;
  terms?: string | null;
  notes?: string | null;
  // Per-invoice language override (Phase 3). Ignored unless 'en' | 'fr'.
  language?: unknown;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function editGeneratedInvoiceAction(
  input: EditGeneratedInvoiceInput,
): Promise<InvoiceEditResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "unauthenticated" };
  if (!UUID_RE.test(input.engagementId)) {
    return { ok: false, error: "invalid" };
  }
  const lines = normalizeLineItems(input.lineItems);
  if (!lines) return { ok: false, error: "invalid_lines" };
  // Component toggles: accept only known ids; null = all on.
  let enabledComponents: TaxComponentId[] | null = null;
  if (Array.isArray(input.enabledComponents)) {
    if (!input.enabledComponents.every(isTaxComponentId)) {
      return { ok: false, error: "invalid" };
    }
    enabledComponents = input.enabledComponents;
  } else if (input.enabledComponents != null) {
    return { ok: false, error: "invalid" };
  }
  const dueDate =
    typeof input.dueDate === "string" && DATE_RE.test(input.dueDate)
      ? input.dueDate
      : null;

  const engagement = await getEngagement(input.engagementId);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "no_invoice" };
  }
  const invoice = await getLatestPaymentRequestForEngagement(input.engagementId);
  if (
    !invoice ||
    invoice.status === "paid" ||
    invoice.status === "canceled" ||
    invoice.invoice_kind !== "generated"
  ) {
    return { ok: false, error: "no_invoice" };
  }

  const settings = await getFirmInvoiceSettings();
  const computed = computeInvoiceTotals(lines, {
    province: settings?.province ?? null,
    taxesEnabled: input.taxesEnabled,
    enabledComponents,
    registrationNumbers: settings
      ? {
          gst: settings.gst_number,
          qst: settings.qst_number,
          pst: settings.pst_number,
        }
      : undefined,
  });
  if (
    computed.totalCents < MIN_TOTAL_CENTS ||
    computed.totalCents > MAX_TOTAL_CENTS
  ) {
    return { ok: false, error: "amount" };
  }

  const ok = await updateGeneratedInvoiceFields(invoice.id, {
    amount_cents: computed.totalCents,
    description: lines[0].description || null,
    line_items: computed.lineItems,
    tax_breakdown: computed.taxLines,
    subtotal_cents: computed.subtotalCents,
    tax_total_cents: computed.taxTotalCents,
    due_date: dueDate,
    invoice_terms: input.terms?.trim() || null,
    invoice_notes: input.notes?.trim() || null,
    ...(input.language === "en" || input.language === "fr"
      ? { invoice_language: input.language }
      : {}),
  });
  if (!ok) return { ok: false, error: "save_failed" };

  // Same in-flight protection as the flat edit: a checkout opened before this
  // edit would charge the old total — expire it.
  if (invoice.stripe_checkout_session_id) {
    await expireOpenStripeCheckout(firm.id, invoice.stripe_checkout_session_id);
  }

  await logUserActivity(firm.id, input.engagementId, "invoice_edited", {
    payment_request_id: invoice.id,
    amount_cents: computed.totalCents,
    invoice_kind: "generated",
    invoice_number: invoice.invoice_number ?? null,
  });
  revalidatePath(`/engagements/${input.engagementId}`);
  return { ok: true };
}

// Edit automation after engagement creation. The same dialog still supports a
// manual invoice; this action only changes what should happen at completion.
// Completed engagements are re-dispatched after the pending job is cancelled,
// and the invoice sender's idempotency guard prevents duplicate billing.
export async function updateInvoiceAutomationAction(
  formData: FormData,
): Promise<InvoiceAutomationEditResult> {
  const engagementId = formData.get("engagement_id");
  const mode = formData.get("mode");
  if (
    typeof engagementId !== "string" ||
    !UUID_RE.test(engagementId) ||
    (mode !== "off" && mode !== "on_completion" && mode !== "delayed")
  ) {
    return { ok: false, error: "invalid" };
  }

  const delayDays =
    mode === "delayed" ? Math.floor(Number(formData.get("delay_days"))) : null;
  const amountCents =
    mode === "off" ? null : Math.floor(Number(formData.get("amount_cents")));
  if (
    (mode === "delayed" &&
      (!Number.isFinite(delayDays) || delayDays! < 1 || delayDays! > 365)) ||
    (mode !== "off" &&
      (!Number.isFinite(amountCents) ||
        amountCents! < 50 ||
        amountCents! > 99_999_999))
  ) {
    return { ok: false, error: "invalid" };
  }

  const [user, firm, engagement, invoice] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    getEngagement(engagementId),
    getLatestPaymentRequestForEngagement(engagementId),
  ]);
  if (!user || !firm || !engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }
  if (invoice && invoice.status !== "canceled") {
    return { ok: false, error: "already_invoiced" };
  }

  const descriptionValue = formData.get("description");
  const description =
    typeof descriptionValue === "string" && descriptionValue.trim()
      ? descriptionValue.trim().slice(0, 500)
      : null;
  const locksDeliverables = formData.get("locks_deliverables") === "true";
  const attachmentValue = formData.get("attachment");
  const attachment =
    mode !== "off" && attachmentValue instanceof File && attachmentValue.size > 0
      ? attachmentValue
      : null;
  let storedAttachment: StoredInvoiceAttachment | undefined;

  if (attachment) {
    const stored = await storeInvoiceAttachment(engagementId, attachment);
    if (!stored.ok) return { ok: false, error: stored.error };
    storedAttachment = stored.attachment;
  }

  const saved = await updateEngagementInvoiceAutomation(engagementId, {
    mode,
    delayDays,
    amountCents,
    description,
    locksDeliverables,
  });
  if (!saved) {
    if (storedAttachment) await removeStoredInvoiceAttachment(storedAttachment);
    return { ok: false, error: "save_failed" };
  }

  try {
    await cancelScheduledInvoice(engagementId);
    if (engagement.status === "complete" && mode !== "off") {
      await dispatchInvoiceOnCompletion({
        ...engagement,
        invoice_auto_mode: mode,
        invoice_delay_days: delayDays,
      });
    }
  } catch (error) {
    // The preference is already saved. Keep the UI successful and let the
    // completion/retry paths remain best-effort, matching completion itself.
    console.error("[updateInvoiceAutomationAction] dispatch failed:", error);
  }

  await logUserActivity(firm.id, engagementId, "invoice_automation_updated", {
    mode,
    delay_days: delayDays,
    amount_cents: amountCents,
    attachment: Boolean(storedAttachment),
  });
  revalidatePath(`/engagements/${engagementId}`);
  return { ok: true };
}
