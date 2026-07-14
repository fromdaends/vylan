// Client messaging notifications (Phase 3).
//
// Debounce model: every send cancels the engagement's pending notify job and
// re-enqueues one DEBOUNCE_MS out, so a burst of messages produces exactly
// ONE email covering the whole burst. The worker re-checks state at send
// time: if the recipient already opened the thread (read pointer) — or, for
// the client, was already emailed about these messages (notified watermark,
// which also makes reruns idempotent) — it sends nothing.
//
// Client email: firm-branded, snippet + magic link straight into the portal
// thread (?view=messages). Accountant email: compact internal note to the
// assigned user (else firm owner), linking to the engagement page.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  getThreadForEngagement,
  listClientMessages,
  markClientNotified,
  type ClientMessageRow,
} from "@/lib/db/client-messages";
import { resolveAccountantContact } from "@/lib/db/portal";
import {
  buildClientMessageEmail,
  buildFirmMessageEmail,
  sendEmail,
} from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";

// 5 minutes after the LAST message of a burst (founder-approved Phase 0
// plan). Long enough to absorb rapid follow-ups, short enough that an
// after-hours client still hears about a reply promptly.
export const MESSAGE_NOTIFY_DEBOUNCE_MS = 5 * 60 * 1000;

// How much of the latest message the email shows.
export const SNIPPET_MAX_LENGTH = 160;

export function buildSnippet(body: string): string {
  const oneCut = body.trim();
  if (oneCut.length <= SNIPPET_MAX_LENGTH) return oneCut;
  return `${oneCut.slice(0, SNIPPET_MAX_LENGTH - 1).trimEnd()}…`;
}

type Msg = Pick<ClientMessageRow, "sender" | "created_at" | "body">;

// PURE: should the CLIENT be emailed, and about how many messages? Skips
// when there's nothing from the firm, when the client already read past the
// newest firm message, or when they were already notified about it.
export function clientNotifyDecision(args: {
  messages: Msg[];
  clientLastReadAt: string | null;
  clientLastNotifiedAt: string | null;
}): { send: false; reason: string } | { send: true; count: number; latest: Msg } {
  const firmMsgs = args.messages.filter((m) => m.sender === "firm");
  const latest = firmMsgs[firmMsgs.length - 1];
  if (!latest) return { send: false, reason: "no_firm_messages" };
  const latestAt = new Date(latest.created_at).getTime();
  const readAt = args.clientLastReadAt
    ? new Date(args.clientLastReadAt).getTime()
    : 0;
  if (readAt >= latestAt) return { send: false, reason: "already_read" };
  const notifiedAt = args.clientLastNotifiedAt
    ? new Date(args.clientLastNotifiedAt).getTime()
    : 0;
  if (notifiedAt >= latestAt) return { send: false, reason: "already_notified" };
  // "New" for the email count = newer than everything the client has either
  // seen or been told about.
  const cutoff = Math.max(readAt, notifiedAt);
  const count = firmMsgs.filter(
    (m) => new Date(m.created_at).getTime() > cutoff,
  ).length;
  return { send: true, count, latest };
}

// PURE: should the FIRM be emailed about client replies? No notified
// watermark on this side (the debounced job per burst bounds volume);
// the read pointer is the only gate.
export function firmNotifyDecision(args: {
  messages: Msg[];
  firmLastReadAt: string | null;
}): { send: false; reason: string } | { send: true; count: number; latest: Msg } {
  const clientMsgs = args.messages.filter((m) => m.sender === "client");
  const latest = clientMsgs[clientMsgs.length - 1];
  if (!latest) return { send: false, reason: "no_client_messages" };
  const readAt = args.firmLastReadAt
    ? new Date(args.firmLastReadAt).getTime()
    : 0;
  if (readAt >= new Date(latest.created_at).getTime()) {
    return { send: false, reason: "already_read" };
  }
  const count = clientMsgs.filter(
    (m) => new Date(m.created_at).getTime() > readAt,
  ).length;
  return { send: true, count, latest };
}

// Rolling debounce: cancel the engagement's pending job, re-enqueue fresh.
// Best-effort by design — callers must never fail a send over scheduling.
export async function scheduleClientMessageNotification(
  engagementId: string,
): Promise<void> {
  await cancelPendingJobs(
    "notify_client_messages",
    (p) => p.engagement_id === engagementId,
  );
  await enqueueJob({
    kind: "notify_client_messages",
    payload: { engagement_id: engagementId },
    runAfter: new Date(Date.now() + MESSAGE_NOTIFY_DEBOUNCE_MS),
  });
}

export async function scheduleFirmMessageNotification(
  engagementId: string,
): Promise<void> {
  await cancelPendingJobs(
    "notify_firm_messages",
    (p) => p.engagement_id === engagementId,
  );
  await enqueueJob({
    kind: "notify_firm_messages",
    payload: { engagement_id: engagementId },
    runAfter: new Date(Date.now() + MESSAGE_NOTIFY_DEBOUNCE_MS),
  });
}

// Job worker: email the CLIENT about unseen firm messages.
export async function processNotifyClientMessagesJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; sent?: boolean }> {
  const engagementId = String(payload.engagement_id ?? "");
  if (!engagementId) return { skipped: "missing_engagement_id" };
  const sb = getServiceRoleSupabase();

  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, client_id, status, title, magic_token")
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return { skipped: "engagement_not_found" };
  // Cancelled portals 404, so the link would be dead. Complete stays fine:
  // the thread is readable read-only.
  if (engagement.status === "cancelled") return { skipped: "cancelled" };
  if (!engagement.magic_token) return { skipped: "no_token" };

  const [messages, thread] = await Promise.all([
    listClientMessages(sb, engagementId),
    getThreadForEngagement(sb, engagementId),
  ]);
  if (
    messages === CLIENT_MESSAGING_SCHEMA_MISSING ||
    thread === CLIENT_MESSAGING_SCHEMA_MISSING
  ) {
    return { skipped: "schema_missing" };
  }

  const decision = clientNotifyDecision({
    messages,
    clientLastReadAt: thread?.client_last_read_at ?? null,
    clientLastNotifiedAt: thread?.client_last_notified_at ?? null,
  });
  if (!decision.send) return { skipped: decision.reason };

  const { data: client } = await sb
    .from("clients")
    .select("display_name, email, locale")
    .eq("id", engagement.client_id)
    .single();
  if (!client?.email) return { skipped: "client_has_no_email" };
  const { data: firm } = await sb
    .from("firms")
    .select("name, logo_url, brand_color")
    .eq("id", engagement.firm_id)
    .single();
  if (!firm) return { skipped: "firm_missing" };

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${appUrl}/r/${engagement.magic_token}?view=messages`;
  const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
  // The sender line: the author of the LATEST message; the thread row holds
  // sender_name, so re-read it off the decision's latest message.
  const latestFull = messages
    .filter((m) => m.sender === "firm")
    .slice(-1)[0];

  const { subject, html, text } = buildClientMessageEmail({
    clientName: client.display_name,
    firmName: firm.name,
    firmLogoUrl,
    brandColor: firm.brand_color,
    senderName: latestFull?.sender_name ?? firm.name,
    engagementTitle: engagement.title,
    snippet: buildSnippet(decision.latest.body),
    count: decision.count,
    url,
    locale: client.locale === "fr" ? "fr" : "en",
  });
  const res = await sendEmail({ to: client.email, subject, html, text });
  if (!res.sent) {
    // "not_configured" (no Resend key, e.g. dev) is permanent — don't retry.
    if (res.reason === "not_configured") return { skipped: "not_configured" };
    return { skipped: `send_failed:${res.reason}` };
  }

  // Watermark AFTER a successful send: reruns skip, later messages notify.
  await markClientNotified(sb, engagementId, decision.latest.created_at);
  return { sent: true };
}

// Job worker: email the ACCOUNTANT about unseen client replies.
export async function processNotifyFirmMessagesJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; sent?: boolean }> {
  const engagementId = String(payload.engagement_id ?? "");
  if (!engagementId) return { skipped: "missing_engagement_id" };
  const sb = getServiceRoleSupabase();

  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, client_id, status, title, assigned_user_id")
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return { skipped: "engagement_not_found" };
  if (engagement.status === "cancelled") return { skipped: "cancelled" };

  const [messages, thread] = await Promise.all([
    listClientMessages(sb, engagementId),
    getThreadForEngagement(sb, engagementId),
  ]);
  if (
    messages === CLIENT_MESSAGING_SCHEMA_MISSING ||
    thread === CLIENT_MESSAGING_SCHEMA_MISSING
  ) {
    return { skipped: "schema_missing" };
  }

  const decision = firmNotifyDecision({
    messages,
    firmLastReadAt: thread?.firm_last_read_at ?? null,
  });
  if (!decision.send) return { skipped: decision.reason };

  const contact = await resolveAccountantContact(sb, {
    assignedUserId: (engagement.assigned_user_id as string | null) ?? null,
    firmId: engagement.firm_id,
  });
  if (!contact) return { skipped: "no_accountant_contact" };
  const { data: client } = await sb
    .from("clients")
    .select("display_name")
    .eq("id", engagement.client_id)
    .single();

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${appUrl}/${contact.locale}/engagements/${engagementId}`;

  const { subject, html, text } = buildFirmMessageEmail({
    accountantName: contact.name,
    clientName: client?.display_name ?? "Client",
    engagementTitle: engagement.title,
    snippet: buildSnippet(decision.latest.body),
    count: decision.count,
    url,
    locale: contact.locale,
  });
  const res = await sendEmail({ to: contact.email, subject, html, text });
  if (!res.sent) {
    if (res.reason === "not_configured") return { skipped: "not_configured" };
    return { skipped: `send_failed:${res.reason}` };
  }
  return { sent: true };
}
