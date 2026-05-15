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
  firmLogoUrl?: string | null;
  engagementTitle: string;
  url: string;
  dueDate: string | null;
  locale: "fr" | "en";
}): { subject: string; html: string; text: string } {
  const logoBlock = buildLogoBlock(opts.firmLogoUrl, opts.firmName);
  if (opts.locale === "fr") {
    const subject = `${opts.firmName} a besoin de quelques documents pour « ${opts.engagementTitle} »`;
    const dueLine = opts.dueDate
      ? `<p style="margin:0 0 16px 0;color:#64748b;font-size:14px">Échéance : ${opts.dueDate}</p>`
      : "";
    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
${logoBlock}<p>Bonjour ${escapeHtml(opts.clientName)},</p>
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
${logoBlock}<p>Hi ${escapeHtml(opts.clientName)},</p>
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

// Optional firm-logo banner rendered at the top of client-facing emails.
// Returns an empty string when no URL is provided so the existing
// templates stay byte-identical for firms that never uploaded a logo.
// Image dimensions are explicit (48×48) for Outlook, which doesn't honour
// CSS width/height alone. Alt text falls back to the firm name when the
// recipient's email client blocks remote images (Gmail default for new
// senders, Outlook default for everything).
function buildLogoBlock(
  logoUrl: string | null | undefined,
  firmName: string,
): string {
  if (!logoUrl) return "";
  return `<div style="margin:0 0 20px 0">
  <img src="${logoUrl}" alt="${escapeHtml(firmName)}" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:8px;object-fit:cover;border:0" />
</div>
`;
}

export function buildWelcomeEmail(opts: {
  firmName: string;
  ownerName: string;
  appUrl: string;
  locale: "fr" | "en";
}): { subject: string; html: string; text: string } {
  if (opts.locale === "fr") {
    const subject = `Bienvenue chez Relai, ${opts.ownerName}`;
    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
<p>Bonjour ${escapeHtml(opts.ownerName)},</p>
<p>Bienvenue chez <strong>Relai</strong> &mdash; vous voilà prêt à arrêter de courir après les documents de vos clients.</p>
<p>Voici trois choses qui prennent moins de cinq minutes :</p>
<ol style="padding-left:20px">
  <li style="margin-bottom:8px"><strong>Ajouter vos clients</strong> &mdash; importez votre fichier CSV existant ou ajoutez-les un par un.</li>
  <li style="margin-bottom:8px"><strong>Créer votre premier engagement</strong> &mdash; choisissez un modèle (T1, T2, tenue de livres) et envoyez le lien magique au client. Aucun mot de passe à créer pour eux.</li>
  <li style="margin-bottom:8px"><strong>Laissez Relai relancer pour vous</strong> &mdash; rappels intelligents, alertes IA si le client envoie le mauvais slip.</li>
</ol>
<p style="margin:24px 0">
  <a href="${opts.appUrl}/dashboard" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Ouvrir mon tableau de bord</a>
</p>
<p style="color:#64748b;font-size:13px">Votre essai gratuit de 14 jours est commencé. Aucun mode de paiement n'est requis avant de choisir un forfait.</p>
<p style="color:#64748b;font-size:13px">Une question ? Répondez directement à ce courriel.</p>
</body></html>`;
    const text = `Bonjour ${opts.ownerName},

Bienvenue chez Relai. Trois choses à faire en moins de cinq minutes :
  1. Ajouter vos clients (CSV ou un par un)
  2. Créer votre premier engagement
  3. Laissez Relai relancer vos clients

Ouvrez votre tableau de bord : ${opts.appUrl}/dashboard

Essai gratuit de 14 jours. Aucun paiement requis avant de choisir un forfait.`;
    return { subject, html, text };
  }
  const subject = `Welcome to Relai, ${opts.ownerName}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
<p>Hi ${escapeHtml(opts.ownerName)},</p>
<p>Welcome to <strong>Relai</strong> &mdash; the end of chasing your clients for documents.</p>
<p>Three things you can do in under five minutes:</p>
<ol style="padding-left:20px">
  <li style="margin-bottom:8px"><strong>Add your clients</strong> &mdash; import your existing CSV or add them one by one.</li>
  <li style="margin-bottom:8px"><strong>Create your first engagement</strong> &mdash; pick a template (T1, T2, bookkeeping) and send the magic link. Clients don't sign in to anything.</li>
  <li style="margin-bottom:8px"><strong>Let Relai chase for you</strong> &mdash; smart reminders + AI flags when a client uploads the wrong slip.</li>
</ol>
<p style="margin:24px 0">
  <a href="${opts.appUrl}/dashboard" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Open my dashboard</a>
</p>
<p style="color:#64748b;font-size:13px">Your 14-day free trial has started. No payment method required until you pick a plan.</p>
<p style="color:#64748b;font-size:13px">Question? Reply directly to this email.</p>
</body></html>`;
  const text = `Hi ${opts.ownerName},

Welcome to Relai. Three things to do in under 5 min:
  1. Add your clients (CSV or one by one)
  2. Create your first engagement
  3. Let Relai chase clients for you

Open your dashboard: ${opts.appUrl}/dashboard

14-day free trial. No payment required to start.`;
  return { subject, html, text };
}

// Client retry email — sent when the AI auto-rejects an upload. The
// wording is intentionally friendly and SPECIFIC: the client should
// feel the firm noticed a problem (not a robot). Phrasing here is
// frozen from the Phase 4 spec — words "AI", "robot", "automatic" /
// "automatique" must never appear.
export function buildUnusableDocRetryEmail(opts: {
  clientName: string;
  firmName: string;
  firmLogoUrl?: string | null;
  requestItemLabel: string;
  issueSummary: string;
  retryLink: string;
  locale: "fr" | "en";
}): { subject: string; html: string; text: string } {
  const logoBlock = buildLogoBlock(opts.firmLogoUrl, opts.firmName);
  if (opts.locale === "fr") {
    const subject = `Action requise — un document à reprendre pour ${opts.firmName}`;
    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
${logoBlock}<p>Bonjour ${escapeHtml(opts.clientName)},</p>
<p>Merci pour le document que vous avez téléversé pour « ${escapeHtml(opts.requestItemLabel)} ». Malheureusement, il semble difficile à utiliser parce que ${escapeHtml(opts.issueSummary)}.</p>
<p>Pourriez-vous reprendre la photo ou téléverser une version plus claire?</p>
<p style="margin:16px 0 8px 0"><strong>Quelques conseils&nbsp;:</strong></p>
<ul style="margin:0 0 16px 20px;padding:0;color:#1e293b;font-size:14px;line-height:1.6">
<li>Prenez la photo dans un endroit bien éclairé, idéalement près d'une fenêtre</li>
<li>Posez le document à plat sur une surface unie</li>
<li>Assurez-vous que toute la page est visible et nette</li>
<li>Évitez les reflets et les ombres</li>
</ul>
<p style="margin:24px 0">
  <a href="${opts.retryLink}" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Téléverser à nouveau</a>
</p>
<p style="color:#64748b;font-size:13px">Ou copiez ce lien dans votre navigateur&nbsp;:<br><span style="font-family:monospace;font-size:12px;word-break:break-all">${opts.retryLink}</span></p>
<p style="margin-top:32px">Merci!<br>L'équipe ${escapeHtml(opts.firmName)}</p>
</body></html>`;
    const text = `Bonjour ${opts.clientName},

Merci pour le document que vous avez téléversé pour « ${opts.requestItemLabel} ». Malheureusement, il semble difficile à utiliser parce que ${opts.issueSummary}.

Pourriez-vous reprendre la photo ou téléverser une version plus claire?

Quelques conseils:
• Prenez la photo dans un endroit bien éclairé, idéalement près d'une fenêtre
• Posez le document à plat sur une surface unie
• Assurez-vous que toute la page est visible et nette
• Évitez les reflets et les ombres

Pour téléverser à nouveau, cliquez ici: ${opts.retryLink}

Merci!
L'équipe ${opts.firmName}`;
    return { subject, html, text };
  }

  const subject = `Quick fix needed — one document to re-send for ${opts.firmName}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
${logoBlock}<p>Hi ${escapeHtml(opts.clientName)},</p>
<p>Thanks for uploading your document for "${escapeHtml(opts.requestItemLabel)}". Unfortunately, it looks like ${escapeHtml(opts.issueSummary)}, so we can't use it as-is.</p>
<p>Could you take another photo or upload a clearer version?</p>
<p style="margin:16px 0 8px 0"><strong>A few tips:</strong></p>
<ul style="margin:0 0 16px 20px;padding:0;color:#1e293b;font-size:14px;line-height:1.6">
<li>Take the photo in good lighting, ideally near a window</li>
<li>Lay the document flat on a plain surface</li>
<li>Make sure the whole page is visible and in focus</li>
<li>Avoid glare and shadows</li>
</ul>
<p style="margin:24px 0">
  <a href="${opts.retryLink}" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Upload again</a>
</p>
<p style="color:#64748b;font-size:13px">Or copy this link into your browser:<br><span style="font-family:monospace;font-size:12px;word-break:break-all">${opts.retryLink}</span></p>
<p style="margin-top:32px">Thanks!<br>The ${escapeHtml(opts.firmName)} team</p>
</body></html>`;
  const text = `Hi ${opts.clientName},

Thanks for uploading your document for "${opts.requestItemLabel}". Unfortunately, it looks like ${opts.issueSummary}, so we can't use it as-is.

Could you take another photo or upload a clearer version?

A few tips:
• Take the photo in good lighting, ideally near a window
• Lay the document flat on a plain surface
• Make sure the whole page is visible and in focus
• Avoid glare and shadows

Click here to upload again: ${opts.retryLink}

Thanks!
The ${opts.firmName} team`;
  return { subject, html, text };
}

export type ReminderTone = "gentle" | "firm" | "deadline" | "overdue";

export function buildReminderEmail(opts: {
  tone: ReminderTone;
  clientName: string;
  firmName: string;
  firmLogoUrl?: string | null;
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
  const logoBlock = buildLogoBlock(opts.firmLogoUrl, opts.firmName);
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
${logoBlock}<p>${escapeHtml(copy.greeting(opts))}</p>
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
