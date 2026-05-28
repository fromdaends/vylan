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
import {
  buildReminderEmail,
  sendEmail,
  type ReminderTone,
} from "@/lib/email";
import { buildReminderSms, sendSms } from "@/lib/sms";
import { getBrandingImageUrlForEmail } from "@/lib/storage";

const DAY_MS = 24 * 60 * 60 * 1000;
void DAY_MS;

export type ReminderPlanItem = {
  tone: ReminderTone;
  runAfter: Date;
  withSms: boolean;
};

export function buildReminderPlan(opts: {
  sentAt: Date;
  dueDate: string | null;
}): ReminderPlanItem[] {
  const plan: ReminderPlanItem[] = [
    { tone: "gentle", runAfter: addDays(opts.sentAt, 3), withSms: false },
    { tone: "firm", runAfter: addDays(opts.sentAt, 7), withSms: true },
    { tone: "deadline", runAfter: addDays(opts.sentAt, 14), withSms: true },
  ];
  if (opts.dueDate) {
    // "Day after due_date" — fire late in the day so morning-of doesn't count.
    const due = new Date(`${opts.dueDate}T23:59:59Z`);
    plan.push({
      tone: "overdue",
      runAfter: addDays(due, 1),
      withSms: false,
    });
  }
  // Dedupe by tone (the planner keeps the earliest of each kind) and drop
  // anything in the past — those are no-ops anyway.
  const seen = new Set<ReminderTone>();
  const out: ReminderPlanItem[] = [];
  for (const p of plan.sort(
    (a, b) => a.runAfter.getTime() - b.runAfter.getTime(),
  )) {
    if (seen.has(p.tone)) continue;
    seen.add(p.tone);
    out.push(p);
  }
  return out;
}

export async function scheduleEngagementReminders(opts: {
  engagementId: string;
  sentAt: Date;
  dueDate: string | null;
}): Promise<void> {
  const plan = buildReminderPlan({
    sentAt: opts.sentAt,
    dueDate: opts.dueDate,
  });
  for (const p of plan) {
    await enqueueJob({
      kind: "send_reminder",
      payload: {
        engagement_id: opts.engagementId,
        tone: p.tone,
        with_sms: p.withSms,
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

// Job worker.
export async function processReminderJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; sent?: { email: boolean; sms: boolean } }> {
  const engagementId = String(payload.engagement_id ?? "");
  const tone = (payload.tone ?? "gentle") as ReminderTone;
  const withSms = Boolean(payload.with_sms);
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
    });
    const res = await sendEmail({ to: client.email, subject, html, text });
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
    metadata: { tone, email_sent: emailSent, sms_sent: smsSent },
  });

  return { sent: { email: emailSent, sms: smsSent } };
}
