// Chasing unpaid invoices.
//
// This is NOT a scheduler. It is a small amount of scheduling ON the queue that
// already chases missing documents: the same `jobs` table, the same
// /api/cron/process-jobs worker, the same enqueue/cancel helpers. The only new
// thing is a job kind. Building a second timer here would mean two things that
// can drift, two places to look when a reminder doesn't arrive, and two crons
// to keep alive.
//
// THE CADENCE: one reminder when the bill comes due, then every N days while it
// is still owed, up to a maximum. Defaults 7 days and 4 reminders, per firm and
// bounded in the database (migration 1260) as well as the UI.
//
// THE WORKER RE-VALIDATES EVERYTHING. Queued jobs are never cancelled on
// payment — they fire and find the invoice settled, and stop. That is
// deliberate: cancellation is a race (a payment landing between the read and
// the cancel leaves an orphaned job), whereas re-reading state at fire time is
// correct no matter what happened in between. cancelInvoiceChase exists only to
// keep the queue tidy, and nothing depends on it having run.

import { addDays } from "date-fns";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { buildInvoiceReminderEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { formatCurrency, formatDate } from "@/lib/format";
import { outstandingCents, isChaseable, isoDay } from "@/lib/invoices/outstanding";
import type { PaymentRequest } from "@/lib/db/payment-requests";

// Bounds mirrored from the CHECK constraints in migration 1260. Exported so the
// Settings form and the server action validate against the same numbers.
export const CHASE_INTERVAL_MIN = 1;
export const CHASE_INTERVAL_MAX = 60;
export const CHASE_MAX_MIN = 1;
export const CHASE_MAX_MAX = 12;
export const CHASE_INTERVAL_DEFAULT = 7;
export const CHASE_MAX_DEFAULT = 4;

export type ChaseSettings = {
  enabledDefault: boolean;
  intervalDays: number;
  maxReminders: number;
};

export const DEFAULT_CHASE_SETTINGS: ChaseSettings = {
  enabledDefault: true,
  intervalDays: CHASE_INTERVAL_DEFAULT,
  maxReminders: CHASE_MAX_DEFAULT,
};

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Never trust a stored value: a row written before a bound was tightened, or by
// hand, must not be able to queue 400 reminders.
export function normalizeChaseSettings(
  raw: Partial<ChaseSettings> | null | undefined,
): ChaseSettings {
  return {
    enabledDefault: raw?.enabledDefault !== false,
    intervalDays: clamp(
      raw?.intervalDays ?? CHASE_INTERVAL_DEFAULT,
      CHASE_INTERVAL_MIN,
      CHASE_INTERVAL_MAX,
    ),
    maxReminders: clamp(
      raw?.maxReminders ?? CHASE_MAX_DEFAULT,
      CHASE_MAX_MIN,
      CHASE_MAX_MAX,
    ),
  };
}

export type ChasePlanItem = { occurrence: number; runAfter: Date };

// When the reminders for one invoice should go.
//
// The anchor is the due date. An invoice with NO due date is "due on receipt"
// by convention, and chasing it the instant it is issued would be rude, so it
// anchors on the issue date plus one interval — the client gets the same grace
// period a dated invoice's terms would have given them.
export function buildChasePlan(opts: {
  issuedOn: string;
  dueDate: string | null;
  settings: ChaseSettings;
  // Entries already in the past are dropped: a due date set last month must not
  // fire four reminders in the next cron tick.
  now?: Date;
}): ChasePlanItem[] {
  const { settings } = opts;
  const now = opts.now ?? new Date();
  const anchor = opts.dueDate
    ? new Date(`${opts.dueDate}T09:00:00Z`)
    : addDays(new Date(`${opts.issuedOn}T09:00:00Z`), settings.intervalDays);
  if (Number.isNaN(anchor.getTime())) return [];

  const plan: ChasePlanItem[] = [];
  for (let i = 0; i < settings.maxReminders; i++) {
    const runAfter = addDays(anchor, settings.intervalDays * i);
    if (runAfter.getTime() <= now.getTime()) continue;
    plan.push({ occurrence: i + 1, runAfter });
  }
  return plan;
}

export async function scheduleInvoiceChase(opts: {
  invoiceId: string;
  issuedOn: string;
  dueDate: string | null;
  settings: ChaseSettings;
  now?: Date;
}): Promise<number> {
  const plan = buildChasePlan(opts);
  for (const item of plan) {
    await enqueueJob({
      kind: "send_invoice_reminder",
      payload: { payment_request_id: opts.invoiceId, occurrence: item.occurrence },
      runAfter: item.runAfter,
    });
  }
  return plan.length;
}

export async function cancelInvoiceChase(invoiceId: string): Promise<number> {
  return cancelPendingJobs(
    "send_invoice_reminder",
    (payload) => payload.payment_request_id === invoiceId,
  );
}

// "Remind now" and a settings change both mean: forget the queued cadence and
// start a fresh one from today.
export async function rescheduleInvoiceChase(opts: {
  invoiceId: string;
  settings: ChaseSettings;
  now?: Date;
}): Promise<number> {
  await cancelInvoiceChase(opts.invoiceId);
  const now = opts.now ?? new Date();
  const today = isoDay(now);
  return scheduleInvoiceChase({
    invoiceId: opts.invoiceId,
    issuedOn: today,
    // Anchoring on today rather than the original due date: the clock restarts
    // from the reminder that was just sent, which is what "resets the cadence"
    // means to the person who clicked it.
    dueDate: null,
    settings: opts.settings,
    now,
  });
}

export type ChaseSendOutcome =
  | { sent: true; occurrence: number }
  | { sent: false; skipped: string };

// Send ONE reminder for one invoice, right now. Shared by the queue worker and
// the "Remind now" action so a manual nudge and an automatic one are the same
// email with the same audit trail.
export async function sendInvoiceReminder(
  invoiceId: string,
  occurrence: number,
  now: Date = new Date(),
): Promise<ChaseSendOutcome> {
  const sb = getServiceRoleSupabase();

  const { data: invRow } = await sb
    .from("payment_requests")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invRow) return { sent: false, skipped: "invoice_not_found" };
  const invoice = invRow as PaymentRequest & {
    amount_paid_cents?: number;
    auto_chase?: boolean;
    chase_count?: number;
  };

  // The one check that makes cancellation unnecessary: paid, void, fully
  // covered by partials, or switched off, and nothing is sent.
  if (!isChaseable(invoice)) return { sent: false, skipped: "not_chaseable" };
  if (!invoice.engagement_id) {
    return { sent: false, skipped: "no_engagement" };
  }

  const { data: engagement } = await sb
    .from("engagements")
    .select("id, title, magic_token, client_id, firm_id")
    .eq("id", invoice.engagement_id)
    .maybeSingle();
  if (!engagement) return { sent: false, skipped: "engagement_not_found" };
  // No portal link means no way to pay, so a reminder would be a dead end.
  if (!engagement.magic_token) return { sent: false, skipped: "no_token" };

  const [{ data: client }, { data: firm }] = await Promise.all([
    sb
      .from("clients")
      .select("display_name, email, locale")
      .eq("id", engagement.client_id)
      .maybeSingle(),
    sb
      .from("firms")
      .select("name, logo_url")
      .eq("id", invoice.firm_id)
      .maybeSingle(),
  ]);
  if (!client || !firm) return { sent: false, skipped: "client_or_firm_missing" };
  if (!client.email) return { sent: false, skipped: "no_client_email" };

  const owed = outstandingCents(invoice);
  // The invoice's own language when the accountant set one, else the client's.
  const locale: "en" | "fr" =
    invoice.invoice_language === "en" || invoice.invoice_language === "fr"
      ? invoice.invoice_language
      : client.locale === "en"
        ? "en"
        : "fr";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
  const overdue = Boolean(invoice.due_date && isoDay(now) > invoice.due_date);

  const email = buildInvoiceReminderEmail({
    clientName: client.display_name,
    firmName: firm.name,
    firmLogoUrl,
    engagementTitle: engagement.title,
    amount: formatCurrency(owed / 100, locale),
    invoiceNumber: invoice.invoice_number ?? null,
    dueDateLabel: invoice.due_date
      ? formatDate(invoice.due_date, locale, "medium")
      : null,
    tone: overdue ? "overdue" : "due",
    url: `${appUrl}/r/${engagement.magic_token}`,
    locale,
  });

  const res = await sendEmail({ to: client.email, ...email });
  if (!res.sent) return { sent: false, skipped: `send_failed:${res.reason}` };

  // Count it and stamp it. Both are read by the invoice UI ("3rd reminder sent
  // 12 August"), so they are updated even though nothing branches on them.
  await sb
    .from("payment_requests")
    .update({
      chase_count: (invoice.chase_count ?? 0) + 1,
      last_chased_at: now.toISOString(),
    })
    .eq("id", invoiceId);

  // Same activity surface as document reminders, so "what has Vylan sent this
  // client" is answerable from one feed.
  await sb.from("activity_log").insert({
    firm_id: invoice.firm_id,
    engagement_id: invoice.engagement_id,
    actor_type: "system",
    action: "invoice_reminder_sent",
    metadata: {
      payment_request_id: invoiceId,
      occurrence,
      outstanding_cents: owed,
      tone: overdue ? "overdue" : "due",
      invoice_number: invoice.invoice_number ?? null,
    },
  });

  return { sent: true, occurrence };
}

// The queue worker. Thin on purpose: every decision is in sendInvoiceReminder,
// so the manual and automatic paths cannot diverge.
export async function processInvoiceReminderJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; sent?: boolean }> {
  const invoiceId = String(payload.payment_request_id ?? "");
  if (!invoiceId) return { skipped: "missing_payment_request_id" };
  const occurrence = Math.max(1, Number(payload.occurrence) || 1);
  const result = await sendInvoiceReminder(invoiceId, occurrence);
  return result.sent ? { sent: true } : { skipped: result.skipped };
}
