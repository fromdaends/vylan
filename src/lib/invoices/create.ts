// Create an invoice (a payment_request) for an engagement, on demand — shared by
// BOTH the "create it now" option on the New engagement page and the manual
// "Request payment" button. This is the one accountant-driven, RLS-scoped path
// for making an invoice at engagement CREATION or any time after (the automation
// in ./send handles the deferred on_completion / delayed case).
//
// It reuses the exact same payment_requests row + "Pay now" portal email, so the
// client experience is identical however the invoice was created.
//
// One invoice per engagement (v1): if a non-cancelled invoice already exists for
// the engagement, this refuses with "already_invoiced" rather than creating a
// second one.

import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import {
  createPaymentRequest,
  getLatestPaymentRequestForEngagement,
  type CreatePaymentRequestInput,
  type PaymentDelivery,
} from "@/lib/db/payment-requests";
import {
  getFirmInvoiceSettings,
  allocateInvoiceSeq,
} from "@/lib/db/invoice-settings";
import { formatInvoiceNumber } from "@/lib/invoices/number";
import {
  computeInvoiceTotals,
  normalizeLineItems,
  MIN_TOTAL_CENTS,
  MAX_TOTAL_CENTS,
} from "@/lib/invoices/totals";
import type { TaxComponentId } from "@/lib/tax/canada";
import { logUserActivity } from "@/lib/db/activity";
import { firmPaymentRails } from "@/lib/payments/rails";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
import { getServerSupabase } from "@/lib/supabase/server";
import { buildPaymentRequestEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { formatCurrency } from "@/lib/format";

// The builder's payload for a GENERATED invoice (migration 0750). Everything
// money-shaped is recomputed server-side from the raw lines — the client's
// preview totals are never trusted.
export type GeneratedInvoicePayload = {
  lineItems: unknown;
  taxesEnabled: boolean;
  // Component ids the accountant left ON. null = all of the province's
  // components (the default).
  enabledComponents: TaxComponentId[] | null;
  dueDate?: string | null; // YYYY-MM-DD
  terms?: string | null;
  notes?: string | null;
};

export type CreateInvoiceInput = {
  engagementId: string;
  amountCents: number;
  description?: string | null;
  delivery: PaymentDelivery;
  // Gate the engagement's Final documents until this invoice is paid.
  locksDeliverables?: boolean;
  attachment?: {
    storagePath: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: number;
    content: Buffer;
  };
  // Present = the Generate path: line items + taxes + numbering. Absent = the
  // simple/attached path, byte-identical to before this feature.
  generated?: GeneratedInvoicePayload;
};

export type CreateInvoiceReason =
  | "unauthenticated"
  | "not_connected"
  | "not_found"
  | "invalid_amount"
  | "invalid_lines"
  | "already_invoiced"
  | "save_failed";

export type CreateInvoiceResult =
  | { ok: true; id: string }
  | { ok: false; reason: CreateInvoiceReason };

// Stripe floor $0.50 up to ~$1M, integer cents.
function isValidAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents >= 50 && cents <= 99_999_999;
}

export async function createInvoiceForEngagement(
  input: CreateInvoiceInput,
): Promise<CreateInvoiceResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, reason: "unauthenticated" };
  // Can't create a payable invoice until the firm can actually receive money on
  // at least one rail (Stripe today; PayPal too once connected — the invoice is
  // provider-agnostic, so any ready rail makes it payable).
  if (!firmPaymentRails(firm).any) {
    return { ok: false, reason: "not_connected" };
  }

  // RLS-scoped, plus an explicit firm check as defence in depth.
  const engagement = await getEngagement(input.engagementId);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, reason: "not_found" };
  }

  // ── Generated invoice: compute everything server-side ─────────────────────
  // The client's preview ran the SAME pure lib (lib/invoices/totals), so what
  // the accountant saw is what we compute here; but THIS computation is the
  // authoritative one — amount_cents (what the rails charge) is derived from
  // the raw lines, never accepted from the client.
  let invoiceFields: Partial<CreatePaymentRequestInput> = {};
  let chargeCents = input.amountCents;
  let description = input.description?.trim() ? input.description.trim() : null;
  const gen = input.generated;
  if (gen) {
    const lines = normalizeLineItems(gen.lineItems);
    if (!lines) return { ok: false, reason: "invalid_lines" };
    const settings = await getFirmInvoiceSettings();
    const computed = computeInvoiceTotals(lines, {
      province: settings?.province ?? null,
      // The per-invoice master toggle is authoritative; the settings default
      // only seeds the builder UI.
      taxesEnabled: gen.taxesEnabled,
      enabledComponents: gen.enabledComponents,
      registrationNumbers: settings
        ? {
            gst: settings.gst_number,
            qst: settings.qst_number,
            pst: settings.pst_number,
          }
        : undefined,
    });
    chargeCents = computed.totalCents;
    if (chargeCents < MIN_TOTAL_CENTS || chargeCents > MAX_TOTAL_CENTS) {
      return { ok: false, reason: "invalid_amount" };
    }
    // The client's portal language decides how the invoice renders; captured at
    // creation (a per-invoice override arrives with the Phase 3 document work).
    const client = await getClient(engagement.client_id);
    const invoiceLanguage = client?.locale === "en" ? "en" : "fr";
    // Fallback description (payments list, emails): the first line's text.
    if (!description) description = lines[0].description;
    invoiceFields = {
      invoice_kind: "generated",
      line_items: computed.lineItems,
      tax_breakdown: computed.taxLines,
      subtotal_cents: computed.subtotalCents,
      tax_total_cents: computed.taxTotalCents,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: gen.dueDate ?? null,
      invoice_terms: gen.terms?.trim() || settings?.default_terms || null,
      invoice_notes: gen.notes?.trim() || settings?.default_notes || null,
      invoice_language: invoiceLanguage,
    };
    // Numbering: allocated only when the firm has invoice settings (no setup =
    // no formal number, by design). Allocation happens as LATE as possible so
    // a validation failure never consumes a number.
    if (settings) {
      const seq = await allocateInvoiceSeq(firm.id);
      if (seq != null) {
        invoiceFields.invoice_seq = seq;
        invoiceFields.invoice_number = formatInvoiceNumber(
          settings.invoice_prefix,
          seq,
        );
      }
    }
  }
  if (!isValidAmount(chargeCents)) {
    return { ok: false, reason: "invalid_amount" };
  }

  // One invoice per engagement (v1). A cancelled/waived invoice frees the slot
  // for a fresh one.
  const existing = await getLatestPaymentRequestForEngagement(engagement.id);
  if (existing && existing.status !== "canceled") {
    return { ok: false, reason: "already_invoiced" };
  }

  // Insert, re-allocating the number when the seq backstop rejects it (the
  // owner lowered the counter into an already-used range, or a concurrent
  // create claimed the same value). The RPC increments past collisions each
  // call, so this self-heals; 8 attempts bounds a deeply-lowered counter.
  let row: Awaited<ReturnType<typeof createPaymentRequest>> = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    row = await createPaymentRequest({
      firm_id: firm.id,
      engagement_id: engagement.id,
      client_id: engagement.client_id,
      amount_cents: chargeCents,
      currency: "cad",
      description,
      delivery: input.delivery,
      requested_by_user_id: user.id,
      locks_deliverables: input.locksDeliverables === true,
      // Record HOW this invoice exists: 'generated' (line items, Vylan renders
      // the document) or 'attached' (accountant supplied their own file — the
      // pre-existing flow, now labelled). Plain rows (no attachment, no
      // builder) stay null like every legacy row.
      ...(input.attachment && !gen ? { invoice_kind: "attached" as const } : {}),
      ...invoiceFields,
    });
    if (row !== "seq_duplicate") break;
    const seq = await allocateInvoiceSeq(firm.id);
    if (seq == null) {
      // Can't get a fresh number — record the invoice without one rather than
      // blocking billing (the number is presentation; the money is the point).
      delete invoiceFields.invoice_seq;
      delete invoiceFields.invoice_number;
    } else {
      const settings = await getFirmInvoiceSettings();
      invoiceFields.invoice_seq = seq;
      invoiceFields.invoice_number = formatInvoiceNumber(
        settings?.invoice_prefix ?? "",
        seq,
      );
    }
  }
  // A concurrent create won the one-invoice race (DB unique index caught it):
  // report it as already-invoiced, the same as the app-layer guard above.
  if (row === "duplicate") return { ok: false, reason: "already_invoiced" };
  if (!row || row === "seq_duplicate") return { ok: false, reason: "save_failed" };

  await logUserActivity(firm.id, engagement.id, "payment_requested", {
    amount_cents: chargeCents,
    currency: "cad",
    payment_request_id: row.id,
    locks_deliverables: input.locksDeliverables === true,
    ...(gen
      ? {
          invoice_kind: "generated",
          invoice_number: invoiceFields.invoice_number ?? null,
          subtotal_cents: invoiceFields.subtotal_cents,
          tax_total_cents: invoiceFields.tax_total_cents,
        }
      : {}),
  });

  // The engagement now has money owed against it. Hooked HERE rather than in the
  // two callers because this is the one accountant-driven create path (the
  // "Request payment" button and the New engagement page's "create it now" both
  // land here); the deferred automation has its own hook in ./send.
  //
  // This rarely moves the stage on its own — the resolver gates awaiting_payment
  // on preparation being reached, so an invoice raised at engagement CREATION
  // (0610) can't jump a brand-new engagement past collecting. It matters when the
  // work is already done and only the bill was missing.
  await syncEngagementStage(await getServerSupabase(), engagement.id);

  // Email the pay link when the accountant chose email / both AND the engagement
  // has been sent (a draft has no magic_token / portal yet). Best-effort: an
  // email failure never undoes the recorded invoice.
  if (
    (input.delivery === "email" || input.delivery === "both") &&
    engagement.magic_token
  ) {
    try {
      const client = await getClient(engagement.client_id);
      if (client?.email) {
        const appUrl = process.env.APP_URL ?? "http://localhost:3000";
        const locale = client.locale === "en" ? "en" : "fr";
        const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
        const email = buildPaymentRequestEmail({
          clientName: client.display_name,
          firmName: firm.name,
          firmLogoUrl,
          engagementTitle: engagement.title,
          // The charged TOTAL (subtotal + taxes for generated invoices).
          amount: formatCurrency(chargeCents / 100, locale),
          url: `${appUrl}/r/${engagement.magic_token}`,
          locale,
        });
        await sendEmail({
          to: client.email,
          ...email,
          attachments: input.attachment
            ? [
                {
                  filename: input.attachment.filename,
                  content: input.attachment.content,
                },
              ]
            : undefined,
        });
      }
    } catch (e) {
      console.error("[invoices] createInvoiceForEngagement email failed:", e);
    }
  }

  return { ok: true, id: row.id };
}
