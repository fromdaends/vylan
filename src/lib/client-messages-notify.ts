// Client messaging notifications (Phase 3).
//
// Keyed on the CLIENT since 1440 — one thread per client means one debounce
// per client, not per engagement. Job payloads carry client_id; the workers
// still accept a legacy engagement_id payload and resolve it, so jobs already
// queued when this deploys still fire correctly.
//
// Debounce model: every send cancels the client's pending notify job and
// re-enqueues one DEBOUNCE_MS out, so a burst of messages produces exactly
// ONE email covering the whole burst. The worker re-checks state at send
// time: if the recipient already opened the thread (read pointer) — or, for
// the client, was already emailed about these messages (notified watermark,
// which also makes reruns idempotent) — it sends nothing.
//
// Client email: firm-branded, snippet + magic link straight into the portal
// thread (?view=messages). The link needs SOME live engagement of theirs to
// hang off, since portal links are per-engagement; the newest usable one wins.
// Accountant email: compact internal note to the assigned user (else firm
// owner), linking to the conversation.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  getThreadForClient,
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
import {
  emailDetailLevelFor,
  wantsEmailFor,
} from "@/lib/notifications/notify";

// Name-free copy for recipients on the "minimal" email detail level.
const MINIMAL_COPY = {
  en: {
    subject: "You have new activity in Vylan",
    body: "A client has written to you in Vylan.",
    cta: "Open Vylan",
  },
  fr: {
    subject: "Vous avez de nouvelles activités dans Vylan",
    body: "Un client vous a écrit dans Vylan.",
    cta: "Ouvrir Vylan",
  },
} as const;

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

// Rolling debounce: cancel the client's pending job, re-enqueue fresh.
// Best-effort by design — callers must never fail a send over scheduling.
export async function scheduleClientMessageNotification(
  clientId: string,
): Promise<void> {
  await cancelPendingJobs(
    "notify_client_messages",
    (p) => p.client_id === clientId,
  );
  await enqueueJob({
    kind: "notify_client_messages",
    payload: { client_id: clientId },
    runAfter: new Date(Date.now() + MESSAGE_NOTIFY_DEBOUNCE_MS),
  });
}

export async function scheduleFirmMessageNotification(
  clientId: string,
): Promise<void> {
  await cancelPendingJobs(
    "notify_firm_messages",
    (p) => p.client_id === clientId,
  );
  await enqueueJob({
    kind: "notify_firm_messages",
    payload: { client_id: clientId },
    runAfter: new Date(Date.now() + MESSAGE_NOTIFY_DEBOUNCE_MS),
  });
}

// Which client a notify job is about. New jobs carry client_id; jobs queued
// before this deploy carry engagement_id, so resolve those rather than dropping
// somebody's pending notification on the floor.
async function resolveJobClientId(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const clientId = String(payload.client_id ?? "");
  if (clientId) return clientId;
  const engagementId = String(payload.engagement_id ?? "");
  if (!engagementId) return null;
  const { data } = await sb
    .from("engagements")
    .select("client_id")
    .eq("id", engagementId)
    .maybeSingle();
  return (data as { client_id: string } | null)?.client_id ?? null;
}

// The engagement to hang a portal link off, newest first. Portal links are
// per-engagement, so a client-level notification still needs one — any live,
// unexpired, tokened engagement of theirs will do, and they all now open the
// same conversation. Null when the client has no usable portal link at all
// (in which case the client email is skipped: there would be nowhere to send
// them). `complete` is included because a completed portal still opens.
async function newestPortalEngagement(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  clientId: string,
): Promise<{ id: string; title: string; magic_token: string } | null> {
  const { data } = await sb
    .from("engagements")
    .select("id, title, magic_token, magic_expires_at, status, created_at")
    .eq("client_id", clientId)
    .not("magic_token", "is", null)
    .neq("status", "cancelled")
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(20);
  const now = Date.now();
  for (const e of (data ?? []) as {
    id: string;
    title: string;
    magic_token: string | null;
    magic_expires_at: string | null;
  }[]) {
    if (!e.magic_token) continue;
    if (e.magic_expires_at && new Date(e.magic_expires_at).getTime() < now) {
      continue;
    }
    return { id: e.id, title: e.title, magic_token: e.magic_token };
  }
  return null;
}

// Job worker: email the CLIENT about unseen firm messages.
export async function processNotifyClientMessagesJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; sent?: boolean }> {
  const sb = getServiceRoleSupabase();
  const clientId = await resolveJobClientId(sb, payload);
  if (!clientId) return { skipped: "missing_client_id" };

  // A portal link is the whole point of this email, so no usable link means
  // nothing to send. Cancelled/draft/expired ones are excluded upstream —
  // they 404 on open.
  const portal = await newestPortalEngagement(sb, clientId);
  if (!portal) return { skipped: "no_portal_link" };

  const [messages, thread] = await Promise.all([
    listClientMessages(sb, clientId),
    getThreadForClient(sb, clientId),
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
    .select("firm_id, display_name, email, locale")
    .eq("id", clientId)
    .single();
  if (!client?.email) return { skipped: "client_has_no_email" };
  const { data: firm } = await sb
    .from("firms")
    .select("name, logo_url, brand_color")
    .eq("id", client.firm_id)
    .single();
  if (!firm) return { skipped: "firm_missing" };

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${appUrl}/r/${portal.magic_token}?view=messages`;
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
    // The chat is no longer about one engagement, so the email doesn't claim
    // it is. buildClientMessageEmail drops the "about X" clause on null.
    engagementTitle: null,
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
  await markClientNotified(sb, clientId, decision.latest.created_at);
  return { sent: true };
}

// Job worker: email the ACCOUNTANT about unseen client replies.
export async function processNotifyFirmMessagesJob(
  payload: Record<string, unknown>,
): Promise<{ skipped?: string; sent?: boolean }> {
  const sb = getServiceRoleSupabase();
  const clientId = await resolveJobClientId(sb, payload);
  if (!clientId) return { skipped: "missing_client_id" };

  const { data: client } = await sb
    .from("clients")
    .select("firm_id, display_name")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { skipped: "client_not_found" };

  const [messages, thread] = await Promise.all([
    listClientMessages(sb, clientId),
    getThreadForClient(sb, clientId),
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

  // Who hears about it: the client has no single owner, so fall back to whoever
  // is assigned their most recent live engagement — the person most likely to
  // be working with them right now — and to the firm owner when there is none.
  const { data: recentEngagement } = await sb
    .from("engagements")
    .select("assigned_user_id, created_at")
    .eq("client_id", clientId)
    .not("assigned_user_id", "is", null)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contact = await resolveAccountantContact(sb, {
    assignedUserId:
      (recentEngagement as { assigned_user_id: string | null } | null)
        ?.assigned_user_id ?? null,
    firmId: client.firm_id,
  });
  if (!contact) return { skipped: "no_accountant_contact" };

  // The Notifications tab's Email switch for "Client replied" governs THIS
  // email — this debounced job is the event's only email path (the send route
  // writes the in-app row with suppressEmail). Without this check the switch
  // would appear to work and do nothing. users.email is unique, so resolving
  // the contact back to a user id is exact; unresolvable means we fail open and
  // send, which is the safe direction for a client waiting on an answer.
  const { data: contactUser } = await sb
    .from("users")
    .select("id")
    .eq("email", contact.email)
    .maybeSingle();
  const contactUserId = (contactUser as { id: string } | null)?.id ?? null;
  if (
    contactUserId &&
    !(await wantsEmailFor(sb, contactUserId, "message.client_replied"))
  ) {
    return { skipped: "email_pref_off" };
  }

  // Straight to the conversation where possible: ?panel=messages opens the
  // messages popup, and the client's row sits at the top of it with its unread
  // dot. That deep link only exists on the engagement page, so a client with no
  // engagement (now possible — the chat doesn't need one) gets their profile.
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const { data: anyEngagement } = await sb
    .from("engagements")
    .select("id, created_at")
    .eq("client_id", clientId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const engagementId = (anyEngagement as { id: string } | null)?.id ?? null;
  const url = engagementId
    ? `${appUrl}/${contact.locale}/engagements/${engagementId}?panel=messages`
    : `${appUrl}/${contact.locale}/clients/${clientId}`;

  // Respect the recipient's detail level. This job is the ONLY email for
  // message.client_replied, so without this a user on "minimal" still receives
  // the client name, the engagement title AND a snippet of the message body —
  // the single most sensitive of these emails to land in a shared inbox.
  const detail = contactUserId
    ? await emailDetailLevelFor(sb, contactUserId)
    : "full";
  if (detail === "minimal") {
    const copy = MINIMAL_COPY[contact.locale];
    const res = await sendEmail({
      to: contact.email,
      subject: copy.subject,
      html: `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b"><p>${copy.body}</p><p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#1D3AFF;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${copy.cta}</a></p></body></html>`,
      text: `${copy.body}

${url}`,
    });
    if (!res.sent) {
      if (res.reason === "not_configured") return { skipped: "not_configured" };
      return { skipped: `send_failed:${res.reason}` };
    }
    return { sent: true };
  }

  const { subject, html, text } = buildFirmMessageEmail({
    accountantName: contact.name,
    clientName: client.display_name ?? "Client",
    // No engagement framing: this is the client's general thread.
    engagementTitle: null,
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
