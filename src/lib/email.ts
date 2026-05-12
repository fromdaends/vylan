// Email sender. If RESEND_API_KEY is not configured, every send is a no-op
// and we log to console (so dev works without Resend).

import { Resend } from "resend";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

let _client: Resend | null = null;
function client(): Resend | null {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key || key.trim() === "") return null;
  _client = new Resend(key);
  return _client;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: SendArgs): Promise<
  { sent: true; id: string } | { sent: false; reason: string }
> {
  const c = client();
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@relai.app";
  if (!c) {
    console.warn(
      `[email] Resend not configured — would send to ${to}: ${subject}`,
    );
    return { sent: false, reason: "not_configured" };
  }
  const res = await c.emails.send({ from, to, subject, html, text });
  if (res.error) {
    console.error("[email] Resend error:", res.error);
    return { sent: false, reason: res.error.message };
  }
  return { sent: true, id: res.data?.id ?? "" };
}

export function buildEngagementInviteEmail(opts: {
  clientName: string;
  firmName: string;
  engagementTitle: string;
  url: string;
  dueDate: string | null;
  locale: "fr" | "en";
}): { subject: string; html: string; text: string } {
  if (opts.locale === "fr") {
    const subject = `${opts.firmName} a besoin de quelques documents pour « ${opts.engagementTitle} »`;
    const dueLine = opts.dueDate
      ? `<p style="margin:0 0 16px 0;color:#64748b;font-size:14px">Échéance : ${opts.dueDate}</p>`
      : "";
    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
<p>Bonjour ${escapeHtml(opts.clientName)},</p>
<p>${escapeHtml(opts.firmName)} a préparé une liste de documents à soumettre pour <strong>${escapeHtml(opts.engagementTitle)}</strong>.</p>
${dueLine}
<p style="margin:24px 0">
  <a href="${opts.url}" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Ouvrir mon portail</a>
</p>
<p style="color:#64748b;font-size:13px">Ou copiez ce lien dans votre navigateur : <br><span style="font-family:monospace;font-size:12px;word-break:break-all">${opts.url}</span></p>
<p style="color:#64748b;font-size:12px;margin-top:32px">Aucun mot de passe à créer. Ce lien est valide pendant 90 jours.</p>
</body></html>`;
    const text = `Bonjour ${opts.clientName},

${opts.firmName} a préparé une liste de documents à soumettre pour ${opts.engagementTitle}.${opts.dueDate ? `\nÉchéance : ${opts.dueDate}` : ""}

Ouvrez votre portail : ${opts.url}

Aucun mot de passe à créer. Lien valide pendant 90 jours.`;
    return { subject, html, text };
  }

  const subject = `${opts.firmName} needs a few documents for "${opts.engagementTitle}"`;
  const dueLine = opts.dueDate
    ? `<p style="margin:0 0 16px 0;color:#64748b;font-size:14px">Due: ${opts.dueDate}</p>`
    : "";
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
<p>Hi ${escapeHtml(opts.clientName)},</p>
<p>${escapeHtml(opts.firmName)} put together a list of documents they need for <strong>${escapeHtml(opts.engagementTitle)}</strong>.</p>
${dueLine}
<p style="margin:24px 0">
  <a href="${opts.url}" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Open my portal</a>
</p>
<p style="color:#64748b;font-size:13px">Or copy this link into your browser:<br><span style="font-family:monospace;font-size:12px;word-break:break-all">${opts.url}</span></p>
<p style="color:#64748b;font-size:12px;margin-top:32px">No password required. This link is valid for 90 days.</p>
</body></html>`;
  const text = `Hi ${opts.clientName},

${opts.firmName} put together a list of documents they need for ${opts.engagementTitle}.${opts.dueDate ? `\nDue: ${opts.dueDate}` : ""}

Open your portal: ${opts.url}

No password required. Link valid for 90 days.`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ReminderTone = "gentle" | "firm" | "deadline" | "overdue";

export function buildReminderEmail(opts: {
  tone: ReminderTone;
  clientName: string;
  firmName: string;
  engagementTitle: string;
  url: string;
  dueDate: string | null;
  pendingRequiredCount: number;
  locale: "fr" | "en";
}): { subject: string; html: string; text: string } {
  const copy = COPY[opts.locale][opts.tone];
  const subject = copy.subject(opts);
  const body = copy.body(opts);
  const cta = opts.locale === "fr" ? "Téléverser mes documents" : "Upload my documents";
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
<p>${escapeHtml(copy.greeting(opts))}</p>
<p>${body.html}</p>
<p style="margin:24px 0">
  <a href="${opts.url}" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">${cta}</a>
</p>
<p style="color:#64748b;font-size:13px">${escapeHtml(opts.locale === "fr" ? "Ou copiez ce lien :" : "Or copy this link:")}<br><span style="font-family:monospace;font-size:12px;word-break:break-all">${opts.url}</span></p>
<p style="color:#64748b;font-size:12px;margin-top:32px">${escapeHtml(opts.firmName)}</p>
</body></html>`;
  const text = `${copy.greeting(opts)}

${body.text}

${opts.locale === "fr" ? "Téléverser" : "Upload"}: ${opts.url}

— ${opts.firmName}`;
  return { subject, html, text };
}

type CopyVariant = {
  subject: (o: BuildOpts) => string;
  greeting: (o: BuildOpts) => string;
  body: (o: BuildOpts) => { html: string; text: string };
};

type BuildOpts = Parameters<typeof buildReminderEmail>[0];

const COPY: Record<"fr" | "en", Record<ReminderTone, CopyVariant>> = {
  fr: {
    gentle: {
      subject: (o) =>
        `Petit rappel : ${o.firmName} attend toujours quelques documents`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      body: (o) => ({
        html: `Juste un petit rappel — votre comptable attend toujours <strong>${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s" : ""}</strong> pour <strong>${escapeHtml(o.engagementTitle)}</strong>. Aucune urgence, mais plus tôt vous nous les envoyez, plus tôt nous pouvons avancer.`,
        text: `Juste un petit rappel — votre comptable attend toujours ${o.pendingRequiredCount} document(s) pour ${o.engagementTitle}.`,
      }),
    },
    firm: {
      subject: (o) =>
        `${o.firmName} attend toujours vos documents`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      body: (o) => ({
        html: `Cela fait une semaine que nous attendons vos documents pour <strong>${escapeHtml(o.engagementTitle)}</strong>. Il reste ${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s à téléverser" : " à téléverser"}. Pouvez-vous y jeter un œil cette semaine&nbsp;?`,
        text: `Cela fait une semaine que nous attendons vos documents pour ${o.engagementTitle}. Il reste ${o.pendingRequiredCount} document(s) à téléverser.`,
      }),
    },
    deadline: {
      subject: (o) =>
        `L'échéance approche pour « ${o.engagementTitle} »`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      body: (o) => ({
        html: `Petite alerte&nbsp;: l'échéance <strong>${o.dueDate ?? ""}</strong> approche et il manque encore <strong>${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s" : ""}</strong> pour <strong>${escapeHtml(o.engagementTitle)}</strong>. Pour éviter des retards, merci de les téléverser dès que possible.`,
        text: `Échéance ${o.dueDate ?? ""} approche pour ${o.engagementTitle}. Il manque ${o.pendingRequiredCount} document(s).`,
      }),
    },
    overdue: {
      subject: (o) =>
        `Échéance dépassée — ${o.engagementTitle}`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      body: (o) => ({
        html: `L'échéance du <strong>${o.dueDate ?? ""}</strong> est passée et nous attendons toujours <strong>${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s" : ""}</strong> pour <strong>${escapeHtml(o.engagementTitle)}</strong>. Pouvez-vous nous les envoyer rapidement&nbsp;?`,
        text: `Échéance ${o.dueDate ?? ""} dépassée. Il manque ${o.pendingRequiredCount} document(s) pour ${o.engagementTitle}.`,
      }),
    },
  },
  en: {
    gentle: {
      subject: (o) =>
        `Quick reminder: ${o.firmName} is still waiting on a few documents`,
      greeting: (o) => `Hi ${o.clientName},`,
      body: (o) => ({
        html: `Just a friendly nudge — your accountant is still waiting on <strong>${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s" : ""}</strong> for <strong>${escapeHtml(o.engagementTitle)}</strong>. No rush, but the sooner we have them, the sooner we can move forward.`,
        text: `Friendly nudge — your accountant is still waiting on ${o.pendingRequiredCount} document(s) for ${o.engagementTitle}.`,
      }),
    },
    firm: {
      subject: (o) => `${o.firmName} is still waiting on your documents`,
      greeting: (o) => `Hi ${o.clientName},`,
      body: (o) => ({
        html: `It's been a week and we're still waiting on your documents for <strong>${escapeHtml(o.engagementTitle)}</strong>. There ${o.pendingRequiredCount > 1 ? "are" : "is"} <strong>${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s" : ""}</strong> left to upload. Can you take a few minutes this week to send them in?`,
        text: `It's been a week. ${o.pendingRequiredCount} document(s) still missing for ${o.engagementTitle}.`,
      }),
    },
    deadline: {
      subject: (o) => `Deadline approaching for "${o.engagementTitle}"`,
      greeting: (o) => `Hi ${o.clientName},`,
      body: (o) => ({
        html: `Heads up — the <strong>${o.dueDate ?? ""}</strong> deadline is coming up and you still owe us <strong>${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s" : ""}</strong> for <strong>${escapeHtml(o.engagementTitle)}</strong>. Please upload them as soon as you can to avoid delays.`,
        text: `Deadline ${o.dueDate ?? ""} coming up for ${o.engagementTitle}. ${o.pendingRequiredCount} document(s) still missing.`,
      }),
    },
    overdue: {
      subject: (o) => `Overdue — ${o.engagementTitle}`,
      greeting: (o) => `Hi ${o.clientName},`,
      body: (o) => ({
        html: `The <strong>${o.dueDate ?? ""}</strong> deadline has passed and we're still missing <strong>${o.pendingRequiredCount} document${o.pendingRequiredCount > 1 ? "s" : ""}</strong> for <strong>${escapeHtml(o.engagementTitle)}</strong>. Please send them in as soon as possible.`,
        text: `Deadline ${o.dueDate ?? ""} has passed. ${o.pendingRequiredCount} document(s) still missing for ${o.engagementTitle}.`,
      }),
    },
  },
};
