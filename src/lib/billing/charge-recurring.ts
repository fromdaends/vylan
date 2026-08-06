// Raising the invoice for one period of an ongoing arrangement (migration 1710).
//
// ── WHERE THIS SITS ────────────────────────────────────────────────────────
//
// Schedules are STARTED at acceptance (lib/engagements/on-accepted.ts) and
// DRAINED by the hourly recurrences cron. This module is the middle: given a
// schedule that is due, bill exactly one period.
//
// ── WHY NOT sendEngagementInvoice ──────────────────────────────────────────
//
// That sender bills ONE captured number — `engagements.invoice_amount_cents`
// (or `deposit_cents`) — as a single line. It is the right shape for a charge
// that happens once, which is every charge it was written for.
//
// A period invoice is a different document: it lists the recurring lines that
// belong to THIS frequency, each with its own rate and tax, and it says which
// period it covers. Bending the one-number sender into that would mean a third
// meaning for `invoice_amount_cents` and a per-kind branch through every rule
// in it — and the rules that matter (the rails gate, the tax computation, the
// numbering, the pay-link email) are not in the sender anyway. They are in
// lib/invoices/*, firmPaymentRails and buildPaymentRequestEmail, and this calls
// exactly those. Nothing about how an invoice is taxed, numbered or emailed
// exists twice; only the question of what goes ON it differs, which is the
// actual difference between the two documents.
//
// ── ORDER OF OPERATIONS (the load-bearing part) ────────────────────────────
//
//  1. CLAIM the period in the ledger. UNIQUE(schedule_id, period_key) means the
//     database itself rejects a second attempt — under cron overlap, a retry,
//     or a manual charge racing the schedule.
//  2. Raise the invoice.
//  3. On failure, RELEASE the claim so the next run retries.
//
// If the process dies between 1 and 3 the period stays burned and that cycle is
// never billed. Deliberate, and the same trade the engagement spawner makes: a
// rare missed charge is visible and recoverable by hand; a duplicate invoice to
// a client is neither.

import {
  createPaymentRequestSR,
  type CreatePaymentRequestInput,
} from "@/lib/db/payment-requests";
import {
  allocateInvoiceSeqSR,
  getFirmInvoiceSettingsSR,
} from "@/lib/db/invoice-settings";
import {
  advanceBillingScheduleSR,
  claimBillingPeriodSR,
  linkChargeToPaymentRequestSR,
  releaseBillingPeriodSR,
  setBillingScheduleStatusSR,
  type BillingSchedule,
} from "@/lib/db/billing-schedules";
import { formatInvoiceNumber } from "@/lib/invoices/number";
import { computeInvoiceTotals, MAX_TOTAL_CENTS } from "@/lib/invoices/totals";
import { dueDateFrom, todayIsoDay } from "@/lib/invoices/terms";
import { firmPaymentRails } from "@/lib/payments/rails";
import { buildPaymentRequestEmail, sendEmail } from "@/lib/email";
import { formatCurrency } from "@/lib/format";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import {
  chargeDescription,
  resolveDueCharge,
} from "@/lib/billing/recurring-charges";
import { localToday, parseIsoDate, toIsoDate } from "@/lib/recurring/schedule";

export type ChargeOutcome =
  | { ok: true; paymentRequestId: string; periodKey: string; cents: number }
  | {
      ok: false;
      reason:
        | "not_due"
        | "duplicate"
        | "no_lines"
        | "not_connected"
        | "engagement_gone"
        | "client_gone"
        | "ended"
        | "create_failed";
    };

type FirmRow = {
  id: string;
  name: string;
  timezone: string;
  logo_url: string | null;
  connect_charges_enabled: boolean;
  paypal_merchant_id?: string | null;
  paypal_payments_receivable?: boolean | null;
  paypal_email_confirmed?: boolean | null;
};

/**
 * Bill one period of one schedule.
 *
 * Best-effort throughout: this runs on a cron and inside the acceptance path,
 * and neither may be brought down by a billing hiccup. Every failure returns a
 * reason the caller can log.
 */
export async function chargeSchedulePeriod(
  schedule: BillingSchedule,
  firm: FirmRow,
  now: Date = new Date(),
): Promise<ChargeOutcome> {
  const sb = getServiceRoleSupabase();

  const scheduled = parseIsoDate(schedule.next_charge_on);
  if (!scheduled) return { ok: false, reason: "create_failed" };

  const due = resolveDueCharge({
    nextChargeOn: scheduled,
    frequency: schedule.frequency,
    anchorDay: schedule.anchor_day,
    today: localToday(firm.timezone, now),
    endsOn: schedule.ends_on ? parseIsoDate(schedule.ends_on) : null,
  });
  if (!due) {
    // Past its end date rather than merely early: retire it, so a finished
    // arrangement stops being looked at every hour forever. ISO dates compare
    // correctly as strings, which is why the column stores them that way.
    if (schedule.ends_on && schedule.next_charge_on > schedule.ends_on) {
      await setBillingScheduleStatusSR(schedule.id, "ended");
      return { ok: false, reason: "ended" };
    }
    return { ok: false, reason: "not_due" };
  }

  const advance = () =>
    advanceBillingScheduleSR(schedule.id, toIsoDate(due.nextChargeOn));

  // ── The engagement must still be live ────────────────────────────────────
  //
  // A cancelled engagement stops billing; a completed one does NOT — an
  // ongoing arrangement that has delivered this month's work is exactly when
  // the money is owed.
  const { data: engRow } = await sb
    .from("engagements")
    .select("id, title, status, magic_token")
    .eq("id", schedule.engagement_id)
    .maybeSingle();
  const engagement = engRow as {
    id: string;
    title: string;
    status: string;
    magic_token: string | null;
  } | null;
  if (!engagement) {
    await setBillingScheduleStatusSR(schedule.id, "ended");
    return { ok: false, reason: "engagement_gone" };
  }
  if (engagement.status === "cancelled" || engagement.status === "canceled") {
    await setBillingScheduleStatusSR(schedule.id, "ended");
    return { ok: false, reason: "ended" };
  }

  const { data: clientRow } = await sb
    .from("clients")
    .select("id, display_name, email, locale, archived_at")
    .eq("id", schedule.client_id)
    .maybeSingle();
  const client = clientRow as {
    display_name: string;
    email: string | null;
    locale: string | null;
    archived_at: string | null;
  } | null;
  if (!client || client.archived_at) {
    // Pause rather than end: un-archiving the client should be able to resume
    // the arrangement without the firm rebuilding it.
    await setBillingScheduleStatusSR(schedule.id, "paused");
    return { ok: false, reason: "client_gone" };
  }

  // No ready rail = the firm cannot receive a payment. Don't raise a dead
  // invoice, and don't advance — the period is still owed, and it will bill on
  // the run after they connect Stripe.
  if (!firmPaymentRails(firm).any) {
    return { ok: false, reason: "not_connected" };
  }

  // ── What this period bills ───────────────────────────────────────────────
  //
  // Read LIVE from engagement_items rather than frozen onto the schedule, so a
  // rate change takes effect from the next period. Invoices already raised are
  // untouched, because they are already raised — which is how a price change
  // mid-arrangement is supposed to behave.
  const lines = await recurringLinesFor(
    schedule.engagement_id,
    schedule.frequency,
  );
  if (lines.length === 0) {
    // Every recurring line was deleted. Nothing to bill, ever again.
    await setBillingScheduleStatusSR(schedule.id, "ended");
    return { ok: false, reason: "no_lines" };
  }

  // ── 1. CLAIM THE PERIOD, before anything is created ──────────────────────
  const claim = await claimBillingPeriodSR({
    schedule_id: schedule.id,
    firm_id: schedule.firm_id,
    period_key: due.periodKey,
  });
  if (claim === "duplicate") {
    // Already billed. Advance so the schedule moves on rather than wedging.
    await advance();
    return { ok: false, reason: "duplicate" };
  }
  if (claim === null) {
    // Pre-1710, or the ledger insert failed. Without the ledger nothing
    // prevents a second charge, so bill nothing — late beats twice.
    return { ok: false, reason: "create_failed" };
  }

  // ── 2. RAISE THE INVOICE ─────────────────────────────────────────────────
  const settings = await getFirmInvoiceSettingsSR(schedule.firm_id);
  const label = chargeDescription(
    schedule.description ?? engagement.title,
    due.periodKey,
  );
  const locale: "en" | "fr" = client.locale === "en" ? "en" : "fr";

  const subtotal = lines.reduce((sum, l) => sum + l.amount_cents, 0);
  let chargeCents = subtotal;
  let invoiceFields: Partial<CreatePaymentRequestInput> = {};

  if (settings) {
    const computed = computeInvoiceTotals(lines, {
      province: settings.province,
      taxesEnabled: settings.default_taxes_enabled,
      enabledComponents: null,
      registrationNumbers: {
        gst: settings.gst_number,
        qst: settings.qst_number,
        pst: settings.pst_number,
      },
    });
    if (computed.totalCents <= MAX_TOTAL_CENTS) {
      chargeCents = computed.totalCents;
      const seq = await allocateInvoiceSeqSR(schedule.firm_id);
      invoiceFields = {
        invoice_kind: "generated",
        line_items: computed.lineItems,
        tax_breakdown: computed.taxLines,
        subtotal_cents: computed.subtotalCents,
        tax_total_cents: computed.taxTotalCents,
        issue_date: todayIsoDay(),
        due_date: dueDateFrom(todayIsoDay(), settings.default_due_days),
        invoice_terms: settings.default_terms,
        invoice_notes: settings.default_notes,
        invoice_language: locale,
        ...(seq != null
          ? {
              invoice_seq: seq,
              invoice_number: formatInvoiceNumber(settings.invoice_prefix, seq),
            }
          : {}),
      };
    }
  }

  if (chargeCents <= 0) {
    // Every line is "we'll tell you later". Nothing chargeable this period —
    // release the claim so it retries once the rates are filled in.
    await releaseBillingPeriodSR(claim.id);
    return { ok: false, reason: "no_lines" };
  }

  const created = await createPaymentRequestSR({
    firm_id: schedule.firm_id,
    engagement_id: schedule.engagement_id,
    client_id: schedule.client_id,
    amount_cents: chargeCents,
    currency: "cad",
    description: label,
    delivery: "email",
    requested_by_user_id: null,
    kind: "recurring",
    billing_period: due.periodKey,
    ...invoiceFields,
  });

  if (created === "duplicate" || created === "seq_duplicate" || !created) {
    // "duplicate" here means the payment_requests index rejected it — the
    // period genuinely already has a live invoice, so the ledger row is the
    // thing that is wrong. Release it and let the next run reconcile.
    await releaseBillingPeriodSR(claim.id);
    // Still advance on a true duplicate: the money for this period exists.
    if (created === "duplicate") {
      await advance();
      return { ok: false, reason: "duplicate" };
    }
    return { ok: false, reason: "create_failed" };
  }

  await linkChargeToPaymentRequestSR(claim.id, created.id);
  await advance();

  // ── 3. Enrichment. None of it may undo the charge. ───────────────────────
  if (client.email && engagement.magic_token) {
    try {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
      const { subject, html, text } = buildPaymentRequestEmail({
        clientName: client.display_name,
        firmName: firm.name,
        firmLogoUrl,
        // The PERIOD, not just the job — "Monthly bookkeeping — 2026-08". Three
        // identical subject lines in three months is how a client stops opening
        // them, and how nobody notices the third one went unpaid.
        engagementTitle: label,
        amount: formatCurrency(chargeCents / 100, locale),
        url: `${appUrl}/r/${engagement.magic_token}`,
        locale,
      });
      await sendEmail({ to: client.email, subject, html, text });
    } catch (e) {
      console.error("[billing] period invoice email failed:", e);
    }
  }

  try {
    await sb.from("activity_log").insert({
      firm_id: schedule.firm_id,
      engagement_id: schedule.engagement_id,
      actor_type: "system",
      action: "recurring_charge_raised",
      metadata: {
        schedule_id: schedule.id,
        period_key: due.periodKey,
        amount_cents: chargeCents,
      },
    });
  } catch (e) {
    console.error("[billing] activity log failed:", e);
  }

  return {
    ok: true,
    paymentRequestId: created.id,
    periodKey: due.periodKey,
    cents: chargeCents,
  };
}

/**
 * The engagement's lines that bill at this frequency, as invoice line items.
 *
 * ── AN HOURLY LINE IS NEVER BILLED AUTOMATICALLY ───────────────────────────
 *
 * `rate_type = 'hour'` means the rate is PER HOUR and nobody yet knows how many.
 * The proposal says so — the totals panel prints "hourly billing determined
 * later" and hasStatableTotal() excludes it from every number the client sees.
 *
 * The first version of this read only `rate_cents`, so a "$150/hour" line was
 * billed as a flat $150 every single month: a number nobody quoted, on a
 * schedule nobody agreed to, contradicting the firm's own screen. The rule is
 * hasStatableTotal's, applied here rather than re-invented — an hourly line
 * becomes an invoice when a human says how many hours, and not before.
 *
 * Lines with no rate at all are dropped for the same reason: a $0.00 line has
 * promised the work for free.
 */
async function recurringLinesFor(
  engagementId: string,
  frequency: string,
): Promise<
  { description: string; quantity: number; unit_cents: number; amount_cents: number }[]
> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("engagement_items")
    .select("name, description, rate_cents, rate_type, billing_frequency, order_index")
    .eq("engagement_id", engagementId)
    .eq("billing_frequency", frequency)
    .order("order_index", { ascending: true });
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[billing] recurring lines read failed:", error.message);
    }
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter(isAutoBillable)
    .map((row) => {
      const cents = row.rate_cents as number;
      return {
        description: String(row.name).trim(),
        quantity: 1,
        unit_cents: cents,
        amount_cents: cents,
      };
    });
}

/**
 * Can this stored line be turned into an invoice line WITHOUT a human?
 *
 * Deliberately the same three questions hasStatableTotal + isMeaningful ask on
 * the proposal, asked of a raw database row. Exported so the schedule-creation
 * scan and the charge itself cannot drift: a frequency that starts a schedule
 * must be one that can actually produce an invoice, or the schedule bills
 * nothing forever.
 */
export function isAutoBillable(row: Record<string, unknown>): boolean {
  const cents = row.rate_cents;
  if (typeof cents !== "number" || cents <= 0) return false;
  // Absent rate_type reads as 'item' — that is the column's default and what
  // every row written before rate types existed meant.
  const rateType = row.rate_type == null ? "item" : row.rate_type;
  if (rateType !== "item") return false;
  return String(row.name ?? "").trim().length > 0;
}
