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
