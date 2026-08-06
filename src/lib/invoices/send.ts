// Invoice automation (migration 0590) — the single create-and-send path used
// by BOTH the completion hook (send on "Mark complete") and the scheduled cron
// worker (send N days later). Service-role, self-contained, and idempotent:
//
//   * loads the engagement / firm / client from trusted server state (never
//     client input), the same way processReminderJob does;
//   * gates on the firm having Stripe Connect charges enabled — no Connect,
//     no auto-invoice (silently, so completion never fails);
//   * needs an amount captured at setup (engagement.invoice_amount_cents);
//   * only fires for a still-complete engagement;
//   * NEVER double-sends: if any non-cancelled payment request already exists
//     for the engagement (auto OR manual), it skips.
//
// It reuses the exact same payment_requests row + "Pay now" portal email the
// manual "Request payment" button creates, so the client experience is
// identical.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  createPaymentRequestSR,
  getPaymentRequestForEngagementKindSR,
  type CreatePaymentRequestInput,
} from "@/lib/db/payment-requests";
import {
  getFirmInvoiceSettingsSR,
  allocateInvoiceSeqSR,
} from "@/lib/db/invoice-settings";
import { formatInvoiceNumber } from "@/lib/invoices/number";
import { computeInvoiceTotals, MAX_TOTAL_CENTS } from "@/lib/invoices/totals";
import { buildPaymentRequestEmail, sendEmail } from "@/lib/email";
import { downloadObject, getBrandingImageUrlForEmail } from "@/lib/storage";
import { getInvoiceAttachmentForEngagementSR } from "@/lib/db/final-documents";
import { firmPaymentRails } from "@/lib/payments/rails";
import { syncEngagementStageSR } from "@/lib/engagements/stage-sync";
import { formatCurrency } from "@/lib/format";
import { dueDateFrom, todayIsoDay } from "@/lib/invoices/terms";
import { invoiceAfterDeposit } from "@/lib/engagements/activation";

/**
 * How much of this engagement's deposit has actually been collected.
 *
 * Only a PAID deposit counts. Best-effort and tolerant: pre-1680 there is no
 * `kind` column, so no deposit can exist and the answer is zero — which leaves
 * the invoice at its full amount, exactly as it behaved before deposits.
 */
async function paidDepositCentsSR(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  engagementId: string,
): Promise<number> {
  const { data, error } = await sb
    .from("payment_requests")
    .select("amount_cents, status")
    .eq("engagement_id", engagementId)
    .eq("kind", "deposit")
    .eq("status", "paid");
  if (error || !data) return 0;
  return (data as Array<{ amount_cents: number | null }>).reduce(
    (sum, r) => sum + (typeof r.amount_cents === "number" ? r.amount_cents : 0),
    0,
  );
}

export type InvoiceSendReason =
  | "no_engagement"
  | "not_complete"
  | "not_connected"
  | "no_amount"
  | "already_sent"
  | "client_or_firm_missing"
  | "save_failed";

export type InvoiceSendResult =
  | { ok: true; paymentRequestId: string; emailSent: boolean }
  | { ok: false; reason: InvoiceSendReason };

// Send the invoice for one engagement. Safe to call more than once (idempotent).
//
// opts.atSpawn (recurring engagements, Phase 4): invoice a freshly SPAWNED
// occurrence at spawn time instead of at completion — the ONLY difference is
// the status gate (a spawn is 'sent'/'in_progress', and invoicing up front is
// the point). Every other rule is identical and deliberately shared: rails
// gate, one-invoice idempotency, generated-invoice upgrade with taxes and a
// fresh number, pay-link email, activity, stage sync.
export async function sendEngagementInvoice(
  engagementId: string,
  opts: {
    atSpawn?: boolean;
    // Workflow stage entry (1560): the engagement is live, not complete —
    // same status rule as at-spawn. The existing "never bill twice" guard
    // below is what makes workflow + invoice_auto_mode overlap safe.
    atStage?: boolean;
    /**
     * WHICH charge this is (migration 1680).
     *
     * 'engagement' — the job's invoice, everything this function meant before.
     * 'deposit'    — what the proposal said was due when the client accepted.
     *                Its amount comes from `engagements.deposit_cents`, and it
     *                may sit alongside the engagement invoice: they are two
     *                charges on one job, not two attempts at one charge.
     *
     * ONE sender rather than two, so the rails gate, the tax upgrade, the
     * numbering, the pay-link email and the activity entry cannot diverge
     * between a deposit and a final bill.
     */
    kind?: "engagement" | "deposit";
  } = {},
): Promise<InvoiceSendResult> {
  const sb = getServiceRoleSupabase();
  const kind = opts.kind ?? "engagement";

  const { data: engagement } = await sb
    .from("engagements")
    .select(
      "id, firm_id, client_id, title, status, magic_token, invoice_amount_cents",
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return { ok: false, reason: "no_engagement" };

  // The deposit's amount lives in its own column (1680). Read separately and
  // best-effort: before the migration is applied the column does not exist, so
  // a deposit simply cannot be raised — the honest outcome, since nothing could
  // have stored one either.
  let depositCents: number | null = null;
  if (kind === "deposit") {
    const { data: dep } = await sb
      .from("engagements")
      .select("deposit_cents")
      .eq("id", engagementId)
      .maybeSingle();
    depositCents = (dep?.deposit_cents as number | null) ?? null;
  }

  // Deliverables lock preference + description (migration 0610), read best-effort
  // so a pre-0610 environment simply gets the safe defaults (not locked / no
  // description) instead of failing the whole send.
  let locksDeliverables = false;
  let invoiceDescription: string | null = null;
  const { data: pref } = await sb
    .from("engagements")
    .select("invoice_locks_deliverables, invoice_description")
    .eq("id", engagementId)
    .maybeSingle();
  if (pref) {
    locksDeliverables = pref.invoice_locks_deliverables === true;
    invoiceDescription =
      (pref.invoice_description as string | null) ?? null;
  }

  // Only invoice finished work. The completion hook calls us right after the
  // status flips to complete; the delayed worker re-checks it here at fire time
  // (the accountant may have reopened it in the meantime). At-spawn invoicing
  // (recurring series) instead requires a LIVE occurrence — never a cancelled
  // or already-completed one.
  // A DEPOSIT is billed the moment the client agrees, so it wants a LIVE
  // engagement — the same rule as an at-spawn invoice, and the opposite of the
  // completion rule that governs the final bill.
  const statusOk =
    opts.atSpawn || opts.atStage || kind === "deposit"
      ? engagement.status === "sent" || engagement.status === "in_progress"
      : engagement.status === "complete";
  if (!statusOk) {
    return { ok: false, reason: "not_complete" };
  }

  // ── THE DEPOSIT COMES OFF THE FINAL BILL ────────────────────────────────
  //
  // Asked directly whether a $1,000 deposit on a $5,000 engagement leaves a
  // $4,000 or a $5,000 final invoice, the founder: "The balance obviously."
  //
  // Without this the client is billed $6,000 for a $5,000 job — two invoices
  // raised by two code paths, neither of which knew about the other. The
  // engagement invoice bills what is LEFT.
  //
  // Only a SETTLED deposit is credited. An unpaid one has taken no money, and
  // deducting it would bill the client less than they owe.
  let amountCents: number | null;
  let depositCreditCents = 0;
  if (kind === "deposit") {
    amountCents = depositCents;
  } else {
    const gross = engagement.invoice_amount_cents as number | null;
    depositCreditCents = await paidDepositCentsSR(sb, engagementId);
    amountCents =
      gross != null && depositCreditCents > 0
        ? invoiceAfterDeposit(gross, depositCreditCents)
        : gross;
  }
  if (!amountCents || amountCents <= 0) {
    // A deposit that covered the whole engagement leaves nothing to bill. That
    // is a correct outcome, not a failure — the money is already collected, and
    // raising a $0 invoice would ask the client to pay nothing.
    return { ok: false, reason: "no_amount" };
  }

  // Idempotency: never bill twice FOR THE SAME KIND. A deposit and the final
  // invoice are two charges on one job and must not block each other, which is
  // what the widened unique index in 1680 enforces at the database.
  const existing = await getPaymentRequestForEngagementKindSR(engagementId, kind);
  if (existing && existing.status !== "canceled") {
    return { ok: false, reason: "already_sent" };
  }

  // Read both rails' readiness. Pre-0730 the paypal_* columns don't exist —
  // retry with the legacy select so the automation keeps working in the
  // deploy->migrate window (the rail check then sees Stripe only, as today).
  const railCols =
    "name, logo_url, connect_charges_enabled, paypal_merchant_id, paypal_payments_receivable, paypal_email_confirmed";
  let firmRes = await sb
    .from("firms")
    .select(railCols)
    .eq("id", engagement.firm_id)
    .maybeSingle();
  if (
    firmRes.error &&
    (firmRes.error.code === "PGRST204" || firmRes.error.code === "42703")
  ) {
    firmRes = await sb
      .from("firms")
      .select("name, logo_url, connect_charges_enabled")
      .eq("id", engagement.firm_id)
      .maybeSingle();
  }
  const firm = firmRes.data as {
    name: string;
    logo_url: string | null;
    connect_charges_enabled: boolean;
    paypal_merchant_id?: string | null;
    paypal_payments_receivable?: boolean | null;
    paypal_email_confirmed?: boolean | null;
  } | null;
  // No ready rail = the firm can't receive a payment; don't create a dead
  // invoice. (Stripe today; a connected PayPal also counts once Phase 2 lands.)
  if (!firm || !firmPaymentRails(firm).any) {
    return { ok: false, reason: "not_connected" };
  }

  const { data: client } = await sb
    .from("clients")
    .select("display_name, email, locale")
    .eq("id", engagement.client_id)
    .maybeSingle();
  if (!client) return { ok: false, reason: "client_or_firm_missing" };

  // Final status re-read right before we bill, to shrink the window where a
  // reopen (which flips status to in_progress) slips between our first check and
  // the insert. Not fully atomic — the DB unique index is the hard backstop
  // against a double-send; this just avoids invoicing freshly-reopened work.
  // (At-spawn re-applies its own live-status rule instead.)
  const { data: fresh } = await sb
    .from("engagements")
    .select("status")
    .eq("id", engagement.id)
    .maybeSingle();
  const freshOk =
    opts.atSpawn || opts.atStage || kind === "deposit"
      ? fresh?.status === "sent" || fresh?.status === "in_progress"
      : fresh?.status === "complete";
  if (!freshOk) {
    return { ok: false, reason: "not_complete" };
  }

  // ── Native invoice (0750, founder decision): once the firm has set up
  // Invoicing, the automation makes a REAL generated invoice — the captured
  // amount becomes a single line item, the firm's default taxes apply on top
  // (per default_taxes_enabled and the province's components), and a number is
  // allocated. A firm that never opened the Invoicing settings keeps the
  // pre-0750 behavior byte-identical: flat amount, no taxes, no number.
  const settings = await getFirmInvoiceSettingsSR(engagement.firm_id);
  let invoiceFields: Partial<CreatePaymentRequestInput> = {};
  let chargeCents = amountCents;
  if (settings) {
    const line = {
      description: invoiceDescription ?? "",
      quantity: 1,
      unit_cents: amountCents,
      amount_cents: amountCents,
    };
    const computed = computeInvoiceTotals([line], {
      province: settings.province,
      taxesEnabled: settings.default_taxes_enabled,
      enabledComponents: null, // all of the province's components
      registrationNumbers: {
        gst: settings.gst_number,
        qst: settings.qst_number,
        pst: settings.pst_number,
      },
    });
    // A taxed total past the rail ceiling would be unchargeable — fall back to
    // the flat amount rather than blocking the send (edge case: ~$1M invoice).
    if (computed.totalCents <= MAX_TOTAL_CENTS) {
      chargeCents = computed.totalCents;
      invoiceFields = {
        invoice_kind: "generated",
        line_items: computed.lineItems,
        tax_breakdown: computed.taxLines,
        subtotal_cents: computed.subtotalCents,
        tax_total_cents: computed.taxTotalCents,
        issue_date: todayIsoDay(),
        // The automated path never set a due date, so every invoice the
        // automation raised was permanently un-chaseable and could never read
        // as overdue — and this is the path nobody is watching. Same helper the
        // builder uses, so a hand-raised and an automatic invoice issued on the
        // same day under the same terms are due on the same day.
        due_date: dueDateFrom(todayIsoDay(), settings.default_due_days),
        invoice_terms: settings.default_terms,
        invoice_notes: settings.default_notes,
        invoice_language: client.locale === "en" ? "en" : "fr",
      };
      const seq = await allocateInvoiceSeqSR(engagement.firm_id);
      if (seq != null) {
        invoiceFields.invoice_seq = seq;
        invoiceFields.invoice_number = formatInvoiceNumber(
          settings.invoice_prefix,
          seq,
        );
      }
    }
  }

  // Insert, re-allocating the number when the seq backstop rejects it (same
  // self-healing loop as the manual create path).
  let row: Awaited<ReturnType<typeof createPaymentRequestSR>> = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    row = await createPaymentRequestSR({
      firm_id: engagement.firm_id,
      engagement_id: engagement.id,
      client_id: engagement.client_id,
      amount_cents: chargeCents,
      currency: "cad",
      description: invoiceDescription,
      // Show it in the portal AND email the pay link — this is an automatic ask,
      // so the client should be actively notified.
      delivery: "both",
      // No human requester: this was automated.
      requested_by_user_id: null,
      // Carry the lock preference set at engagement creation (0610).
      locks_deliverables: locksDeliverables,
      kind,
      ...invoiceFields,
    });
    if (row !== "seq_duplicate") break;
    const seq = await allocateInvoiceSeqSR(engagement.firm_id);
    if (seq == null) {
      delete invoiceFields.invoice_seq;
      delete invoiceFields.invoice_number;
    } else {
      invoiceFields.invoice_seq = seq;
      invoiceFields.invoice_number = formatInvoiceNumber(
        settings?.invoice_prefix ?? "",
        seq,
      );
    }
  }
  // A concurrent auto-send already created the invoice (DB unique index caught
  // it): treat as already sent, never as a failure to retry.
  if (row === "duplicate") return { ok: false, reason: "already_sent" };
  if (!row || row === "seq_duplicate") return { ok: false, reason: "save_failed" };

  // Best-effort email — a send failure never undoes the (recorded) invoice.
  let emailSent = false;
  if (client.email && engagement.magic_token) {
    try {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const locale = client.locale === "en" ? "en" : "fr";
      const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
      const email = buildPaymentRequestEmail({
        clientName: client.display_name,
        firmName: firm.name,
        firmLogoUrl,
        engagementTitle: engagement.title,
        // The charged TOTAL (amount + default taxes once Invoicing is set up).
        amount: formatCurrency(chargeCents / 100, locale),
        url: `${appUrl}/r/${engagement.magic_token}`,
        locale,
      });
      let attachments:
        | Array<{ filename: string; content: Buffer }>
        | undefined;
      const invoiceDocument = await getInvoiceAttachmentForEngagementSR(
        engagement.id,
      );
      if (invoiceDocument) {
        try {
          attachments = [
            {
              filename: invoiceDocument.original_filename,
              content: await downloadObject(invoiceDocument.storage_path),
            },
          ];
        } catch (error) {
          // The invoice itself is still actionable through the portal. A stale
          // object must not suppress the payment email entirely.
          console.error("[invoices] auto-invoice attachment failed:", error);
        }
      }
      const res = await sendEmail({
        to: client.email,
        ...email,
        attachments,
      });
      emailSent = res.sent;
    } catch (e) {
      console.error("[invoices] auto-invoice email failed:", e);
    }
  }

  await sb.from("activity_log").insert({
    firm_id: engagement.firm_id,
    engagement_id: engagement.id,
    actor_type: "system",
    action: "payment_requested",
    metadata: {
      amount_cents: chargeCents,
      currency: "cad",
      payment_request_id: row.id,
      auto: true,
      email_sent: emailSent,
      locks_deliverables: locksDeliverables,
      ...(invoiceFields.invoice_kind === "generated"
        ? {
            invoice_kind: "generated",
            invoice_number: invoiceFields.invoice_number ?? null,
            subtotal_cents: invoiceFields.subtotal_cents,
            tax_total_cents: invoiceFields.tax_total_cents,
          }
        : {}),
    },
  });

  // The automated invoice is now owed. This is the hook for BOTH deferred modes
  // — "invoice on completion" (dispatched the moment the engagement completes)
  // and the delayed cron worker N days later. It's what settles a just-completed
  // engagement onto awaiting_payment instead of leaving it reading "completed"
  // while the client still owes: this runs INSIDE the completion flow, so the
  // stage lands correctly in one pass rather than waiting for the next event.
  await syncEngagementStageSR(engagement.id);

  return { ok: true, paymentRequestId: row.id, emailSent };
}
