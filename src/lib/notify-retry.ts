// Worker for `notify_client_retry` jobs.
//
// Triggered by the Phase 3 router when the AI marks an upload unusable
// AND the firm has auto-reject on AND the client hasn't burned through
// the 2-strike escalation budget yet. Sends a friendly email (always,
// when the client has one) plus a short SMS (when the client has a
// phone AND the 30-min anti-spam window is clear AND Twilio is
// configured).
//
// The client-facing wording never mentions "AI" or "robot" — the
// retry is framed as the firm having noticed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { sendEmail, buildUnusableDocRetryEmail } from "@/lib/email";
import { sendSms, buildUnusableDocRetrySms } from "@/lib/sms";

// 30 minutes. Tunable in one place if the anti-spam window changes.
export const SMS_ANTISPAM_WINDOW_MIN = 30;

export type NotifyRetryResult = {
  skipped?: string;
  emailed?: boolean;
  smsed?: boolean;
};

export async function processNotifyClientRetryJob(
  payload: Record<string, unknown>,
): Promise<NotifyRetryResult> {
  const requestItemId = String(payload.request_item_id ?? "");
  const engagementId = String(payload.engagement_id ?? "");
  const issueSummaryFr = String(payload.issue_summary_fr ?? "");
  const issueSummaryEn = String(payload.issue_summary_en ?? "");
  if (!requestItemId || !engagementId) {
    return { skipped: "missing_ids" };
  }

  const sb = getServiceRoleSupabase();

  const { data: engagement } = await sb
    .from("engagements")
    .select(
      "id, firm_id, client_id, title, magic_token, status, reminders_paused",
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return { skipped: "engagement_not_found" };
  if (engagement.status === "complete" || engagement.status === "cancelled") {
    return { skipped: "engagement_done" };
  }
  if (!engagement.magic_token) return { skipped: "no_token" };

  const { data: requestItem } = await sb
    .from("request_items")
    .select("id, label, label_fr")
    .eq("id", requestItemId)
    .maybeSingle();
  if (!requestItem) return { skipped: "request_item_not_found" };

  const { data: client } = await sb
    .from("clients")
    .select("display_name, email, phone, locale")
    .eq("id", engagement.client_id)
    .single();
  const { data: firm } = await sb
    .from("firms")
    .select("name")
    .eq("id", engagement.firm_id)
    .single();
  if (!client || !firm) return { skipped: "client_or_firm_missing" };

  const locale: "fr" | "en" = client.locale === "en" ? "en" : "fr";
  const issueSummary = locale === "fr" ? issueSummaryFr : issueSummaryEn;
  // Fall back to the other-language summary if the AI returned an
  // empty string for the client's preferred language. Better than
  // sending an email with a bare "() so we can't use it as-is".
  const finalIssueSummary =
    issueSummary || issueSummaryEn || issueSummaryFr || "";

  const itemLabel =
    locale === "fr"
      ? requestItem.label_fr || requestItem.label
      : requestItem.label;

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const retryLink = `${appUrl}/r/${engagement.magic_token}`;

  let emailed = false;
  let smsed = false;

  if (client.email) {
    const { subject, html, text } = buildUnusableDocRetryEmail({
      clientName: client.display_name,
      firmName: firm.name,
      requestItemLabel: itemLabel,
      issueSummary: finalIssueSummary,
      retryLink,
      locale,
    });
    const res = await sendEmail({ to: client.email, subject, html, text });
    emailed = res.sent;
    if (emailed) {
      await sb.from("activity_log").insert({
        firm_id: engagement.firm_id,
        engagement_id: engagement.id,
        actor_type: "system",
        action: "client_retry_email_sent",
        metadata: {
          request_item_id: requestItemId,
          uploaded_file_id: payload.uploaded_file_id ?? null,
          locale,
        },
      });
    }
  }

  if (client.phone) {
    const clear = await isAntispamClear(sb, requestItemId);
    if (clear) {
      const body = buildUnusableDocRetrySms({
        clientName: client.display_name,
        firmName: firm.name,
        requestItemLabel: itemLabel,
        issueSummary: finalIssueSummary,
        retryLink,
        locale,
      });
      const res = await sendSms({ to: client.phone, body });
      smsed = res.sent;
      if (smsed) {
        // Log even an attempted send so the anti-spam window applies
        // whether or not Twilio actually accepted the message — we
        // don't want a Twilio outage to unlock a rapid-fire loop.
        await sb.from("activity_log").insert({
          firm_id: engagement.firm_id,
          engagement_id: engagement.id,
          actor_type: "system",
          action: "client_retry_sms_sent",
          metadata: {
            request_item_id: requestItemId,
            uploaded_file_id: payload.uploaded_file_id ?? null,
            locale,
          },
        });
      }
    }
  }

  return { emailed, smsed };
}

// Returns true if it's been more than SMS_ANTISPAM_WINDOW_MIN since
// the last client_retry_sms_sent activity for this same request_item.
// Exported so tests can drive it directly with a mock supabase.
export async function isAntispamClear(
  supabase: SupabaseClient,
  requestItemId: string,
  windowMin = SMS_ANTISPAM_WINDOW_MIN,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, metadata")
    .eq("action", "client_retry_sms_sent")
    .gte("created_at", since)
    .limit(50);
  if (error) return true; // fail-open on a transient query error
  // The activity row keys request_item_id inside metadata, not as a
  // top-level column, so we filter client-side. We bound the result
  // with limit(50) so a noisy firm never pages through thousands.
  type Row = { metadata: { request_item_id?: string } | null };
  const recent = (data ?? []) as Row[];
  const found = recent.some(
    (r) => r.metadata?.request_item_id === requestItemId,
  );
  return !found;
}
