// Twilio SMS sender. Mirrors the lib/email.ts pattern: if env vars are
// missing, every send is a no-op and we log a warning. Dev works without
// Twilio; production fills in the secrets.

import twilio from "twilio";
import { redactPhone } from "@/lib/redact";

type SendArgs = {
  to: string;
  body: string;
};

let _client: ReturnType<typeof twilio> | null = null;
function client() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || sid.trim() === "" || token.trim() === "") return null;
  _client = twilio(sid, token);
  return _client;
}

export async function sendSms({
  to,
  body,
}: SendArgs): Promise<
  { sent: true; sid: string } | { sent: false; reason: string }
> {
  const c = client();
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!c || !from) {
    // Redact the phone number so a misconfigured prod doesn't dump
    // client PII into the function logs. See lib/redact for the policy.
    console.warn(
      `[sms] Twilio not configured — would send to ${redactPhone(to)}: ${body}`,
    );
    return { sent: false, reason: "not_configured" };
  }
  try {
    const msg = await c.messages.create({ to, from, body });
    return { sent: true, sid: msg.sid };
  } catch (e) {
    console.error("[sms] Twilio error:", e);
    return { sent: false, reason: (e as Error).message };
  }
}

export function buildReminderSms(opts: {
  firmName: string;
  engagementTitle: string;
  url: string;
  locale: "fr" | "en";
}): string {
  if (opts.locale === "fr") {
    return `${opts.firmName} attend toujours des documents pour « ${opts.engagementTitle} ». Téléversez-les ici : ${opts.url}`;
  }
  return `${opts.firmName} is still waiting on documents for "${opts.engagementTitle}". Upload them here: ${opts.url}`;
}

// Short retry SMS — sent when the AI auto-rejects an upload AND the
// 30-min anti-spam window is clear AND the client has a phone on
// file. Same friendly tone as the email; never mentions AI.
export function buildUnusableDocRetrySms(opts: {
  clientName: string;
  firmName: string;
  requestItemLabel: string;
  issueSummary: string;
  retryLink: string;
  locale: "fr" | "en";
}): string {
  if (opts.locale === "fr") {
    return `Bonjour ${opts.clientName}, le document ${opts.requestItemLabel} envoyé à ${opts.firmName} doit être renvoyé (${opts.issueSummary}). Lien: ${opts.retryLink}`;
  }
  return `Hi ${opts.clientName}, the ${opts.requestItemLabel} you sent to ${opts.firmName} needs to be re-uploaded (${opts.issueSummary}). Link: ${opts.retryLink}`;
}
