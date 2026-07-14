// Reminder scheduling + processing.
//
// Default cadence (counted from engagements.sent_at):
//   day_3   gentle email
//   day_7   firm email + SMS (if phone on file)
//   day_14  deadline email + SMS
//   overdue (due_date + 1 day) email
//
// We schedule a job for each of these moments at "send" time. The worker
// re-validates the engagement state when each fires:
//   * skip if status is complete / cancelled
//   * skip if reminders_paused is true
//   * skip if no required items are still pending
// This means uploads don't need to cancel jobs eagerly — the worker
// self-skips. We DO eager-cancel on complete/cancel to avoid noise in
// the queue.

import { addDays } from "date-fns";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { buildReminderEmail, sendEmail } from "@/lib/email";
import { buildReminderSms, sendSms } from "@/lib/sms";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import {
  normalizeReminderSettings,
  type ReminderSettings,
  type ReminderTone,
} from "@/lib/reminder-settings";

const DAY_MS = 24 * 60 * 60 * 1000;
void DAY_MS;

export type ReminderPlanItem = {
  tone: ReminderTone;
  occurrence: number;
  repeatCount: number;
  runAfter: Date;
  withSms: boolean;
  customSubject: string | null;
  customMessage: string | null;
};

export function buildReminderPlan(opts: {
  sentAt: Date;
  dueDate: string | null;
  settings?: ReminderSettings | null;
}): ReminderPlanItem[] {
  const settings = normalizeReminderSettings(opts.settings);
  if (!settings.enabled) return [];

  const plan: ReminderPlanItem[] = [];
  for (const step of settings.steps) {
    if (!step.enabled) continue;
    if (step.timing === "after_due" && !opts.dueDate) continue;
    const anchor =
      step.timing === "after_due"
        ? new Date(`${opts.dueDate}T23:59:59Z`)
        : opts.sentAt;
    for (let occurrence = 1; occurrence <= step.repeatCount; occurrence++) {
      plan.push({
        tone: step.tone,
        occurrence,
        repeatCount: step.repeatCount,
        runAfter: addDays(anchor, step.days * occurrence),
        withSms: step.withSms,
        customSubject: step.customSubject,
        customMessage: step.customMessage,
      });
    }
  }
  // Keep chronological ordering when one reminder type has several occurrences.
  return plan.sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime());
}

export async function scheduleEngagementReminders(opts: {
  engagementId: string;
  sentAt: Date;
  dueDate: string | null;
  settings?: ReminderSettings | null;
}): Promise<void> {
  const plan = buildReminderPlan({
    sentAt: opts.sentAt,
    dueDate: opts.dueDate,
    settings: opts.settings,
  });
  await enqueueReminderPlan(opts.engagementId, plan);
}

async function enqueueReminderPlan(
  engagementId: string,
  plan: ReminderPlanItem[],
  futureOnly = false,
): Promise<void> {
  const entries = futureOnly ? futureReminderPlan(plan) : plan;
  for (const p of entries) {
    await enqueueJob({
      kind: "send_reminder",
      payload: {
        engagement_id: engagementId,
        tone: p.tone,
        occurrence: p.occurrence,
        repeat_count: p.repeatCount,
        with_sms: p.withSms,
        custom_subject: p.customSubject,
        custom_message: p.customMessage,
      },
      runAfter: p.runAfter,
    });
  }
}

export async function cancelEngagementReminders(
  engagementId: string,
): Promise<number> {
  return cancelPendingJobs(
    "send_reminder",
    (payload) => payload.engagement_id === engagementId,
  );
}

// Reschedule ONLY the overdue reminder after a due-date change. The
// gentle/firm/deadline tones are anchored to sent_at and must NOT be
// rebuilt: re-running scheduleEngagementReminders with the original sentAt
// would enqueue those tones with past run_after timestamps, which the cron
// fires immediately (duplicate emails/SMS to the client). Only the overdue
// tone depends on due_date, so cancel just it and re-enqueue for the new
// date when that date is still in the future.
export async function rescheduleOverdueReminder(opts: {
  engagementId: string;
  dueDate: string | null;
  settings?: ReminderSettings | null;
}): Promise<void> {
  await cancelPendingJobs(
    "send_reminder",
    (payload) =>
      payload.engagement_id === opts.engagementId &&
      payload.tone === "overdue",
  );
  if (!opts.dueDate) return;
  const settings = normalizeReminderSettings(opts.settings);
  const step = settings.steps.find((candidate) => candidate.tone === "overdue");
  if (!settings.enabled || !step?.enabled) return;
  const anchor = new Date(`${opts.dueDate}T23:59:59Z`);
  for (let occurrence = 1; occurrence <= step.repeatCount; occurrence++) {
    const repeatedRunAfter = addDays(anchor, step.days * occurrence);
    if (repeatedRunAfter.getTime() <= Date.now()) continue;
    await enqueueJob({
      kind: "send_reminder",
      payload: {
        engagement_id: opts.engagementId,
        tone: "overdue",
        occurrence,
        repeat_count: step.repeatCount,
        with_sms: step.withSms,
        custom_subject: step.customSubject,
        custom_message: step.customMessage,
      },
      runAfter: repeatedRunAfter,
    });
  }
}

export function futureReminderPlan(
  plan: ReminderPlanItem[],
  now = new Date(),
): ReminderPlanItem[] {
  const nowMs = now.getTime();
  return plan.filter((item) => item.runAfter.getTime() > nowMs);
}

// Rebuild a live engagement's cadence after an accountant edits it. Past plan
// entries are deliberately skipped so changing settings can never replay an
// email or SMS that was already due before the edit.
export async function rescheduleEngagementReminders(opts: {
  engagementId: string;
  sentAt: Date;
  dueDate: string | null;
  settings: ReminderSettings;
}): Promise<void> {
  await cancelEngagementReminders(opts.engagementId);
  const plan = buildReminderPlan({
    sentAt: opts.sentAt,
    dueDate: opts.dueDate,
    settings: opts.settings,
  });
  await enqueueReminderPlan(opts.engagementId, plan, true);
}

// Job worker.
export async function processReminderJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; sent?: { email: boolean; sms: boolean } }> {
  const engagementId = String(payload.engagement_id ?? "");
  const tone = (payload.tone ?? "gentle") as ReminderTone;
  const withSms = Boolean(payload.with_sms);
  const occurrence = Math.max(1, Number(payload.occurrence) || 1);
  const repeatCount = Math.max(1, Number(payload.repeat_count) || 1);
  const customSubject =
    typeof payload.custom_subject === "string" ? payload.custom_subject : null;
  const customMessage =
    typeof payload.custom_message === "string" ? payload.custom_message : null;
  if (!engagementId) return { skipped: "missing_engagement_id" };

  const sb = getServiceRoleSupabase();

  const { data: engagement } = await sb
    .from("engagements")
    .select("*")
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return { skipped: "engagement_not_found" };
  if (engagement.status === "complete" || engagement.status === "cancelled") {
    return { skipped: "engagement_done" };
  }
  if (engagement.reminders_paused) {
    return { skipped: "reminders_paused" };
  }
  if (!engagement.magic_token) return { skipped: "no_token" };

  const { data: items } = await sb
    .from("request_items")
    .select("required, status")
    .eq("engagement_id", engagementId);
  const pendingRequired = (items ?? []).filter(
    (i) =>
      i.required && (i.status === "pending" || i.status === "rejected"),
  ).length;
  if (pendingRequired === 0) {
    return { skipped: "all_required_done" };
  }

  const { data: client } = await sb
    .from("clients")
    .select("display_name, email, phone, locale")
    .eq("id", engagement.client_id)
    .single();
  const { data: firm } = await sb
    .from("firms")
    .select("name, logo_url, brand_color")
    .eq("id", engagement.firm_id)
    .single();
  if (!client || !firm) return { skipped: "client_or_firm_missing" };

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${appUrl}/r/${engagement.magic_token}`;
  const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);

  let emailSent = false;
  let smsSent = false;

  if (client.email) {
    const { subject, html, text } = buildReminderEmail({
      tone,
      clientName: client.display_name,
      firmName: firm.name,
      firmLogoUrl,
      brandColor: firm.brand_color,
      engagementTitle: engagement.title,
      url,
      dueDate: engagement.due_date,
      pendingRequiredCount: pendingRequired,
      locale: client.locale,
      customSubject,
      customMessage,
    });
    const res = await sendEmail({ to: client.email, subject, html, text });
    if (!res.sent) return { skipped: `send_failed:${res.reason}` };
    emailSent = res.sent;
  }

  if (withSms && client.phone) {
    const body = buildReminderSms({
      firmName: firm.name,
      engagementTitle: engagement.title,
      url,
      locale: client.locale,
    });
    const res = await sendSms({ to: client.phone, body });
    smsSent = res.sent;
  }

  await sb.from("activity_log").insert({
    firm_id: engagement.firm_id,
    engagement_id: engagement.id,
    actor_type: "system",
    action: "reminder_fired",
    metadata: {
      tone,
      occurrence,
      repeat_count: repeatCount,
      email_sent: emailSent,
      sms_sent: smsSent,
      customized: Boolean(customSubject || customMessage),
    },
  });

  return { sent: { email: emailSent, sms: smsSent } };
}
