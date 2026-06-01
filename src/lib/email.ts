// Email sender. If RESEND_API_KEY is not configured, every send is a no-op
// and we log to console (so dev works without Resend).

import { Resend } from "resend";
import { redactEmail } from "@/lib/redact";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // Optional Reply-To — e.g. internal notifications set this to the person who
  // triggered them so a reply goes straight to them, not to the from address.
  replyTo?: string;
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
  replyTo,
}: SendArgs): Promise<
  { sent: true; id: string } | { sent: false; reason: string }
> {
  const c = client();
  // Sender address resolution. Default is hello@vylan.app (our verified
  // Resend sending domain). RESEND_FROM_EMAIL can override — but if it
  // accidentally still carries the resend.dev sandbox value (set during
  // initial Resend setup and easy to forget about), ignore it: Resend
  // 403s on resend.dev → external recipients, so honoring that value
  // would silently break founder notifications.
  const rawFrom = process.env.RESEND_FROM_EMAIL?.trim();
  const from =
    !rawFrom || /@resend\.dev$/i.test(rawFrom) ? "hello@vylan.app" : rawFrom;
  if (!c) {
    // Redact the recipient so a misconfigured prod doesn't dump client PII
    // into the function logs. The dev-mode signal we actually need is
    // "an email tried to go out" + the subject; the exact recipient adds
    // nothing useful at this stage.
    console.warn(
      `[email] Resend not configured — would send to ${redactEmail(to)}: ${subject}`,
    );
    return { sent: false, reason: "not_configured" };
  }
  const res = await c.emails.send({
    from,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });
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

export function escapeHtml(s: string): string {
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
    const subject = `Bienvenue chez Vylan, ${opts.ownerName}`;
    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
<p>Bonjour ${escapeHtml(opts.ownerName)},</p>
<p>Bienvenue chez <strong>Vylan</strong> &mdash; vous voilà prêt à arrêter de courir après les documents de vos clients.</p>
<p>Voici trois choses qui prennent moins de cinq minutes :</p>
<ol style="padding-left:20px">
  <li style="margin-bottom:8px"><strong>Ajouter vos clients</strong> &mdash; importez votre fichier CSV existant ou ajoutez-les un par un.</li>
  <li style="margin-bottom:8px"><strong>Créer votre premier engagement</strong> &mdash; choisissez un modèle (T1, T2, tenue de livres) et envoyez le lien magique au client. Aucun mot de passe à créer pour eux.</li>
  <li style="margin-bottom:8px"><strong>Laissez Vylan relancer pour vous</strong> &mdash; rappels intelligents, alertes IA si le client envoie le mauvais slip.</li>
</ol>
<p style="margin:24px 0">
  <a href="${opts.appUrl}/dashboard" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Ouvrir mon aperçu</a>
</p>
<p style="color:#64748b;font-size:13px">Vous êtes en démo. Aucun mode de paiement n'est requis — nous discuterons des tarifs ensemble quand vous serez prêts.</p>
<p style="color:#64748b;font-size:13px">Une question ? Répondez directement à ce courriel.</p>
</body></html>`;
    const text = `Bonjour ${opts.ownerName},

Bienvenue chez Vylan. Trois choses à faire en moins de cinq minutes :
  1. Ajouter vos clients (CSV ou un par un)
  2. Créer votre premier engagement
  3. Laissez Vylan relancer vos clients

Ouvrez votre aperçu : ${opts.appUrl}/dashboard

Vous êtes en démo. Aucun paiement requis — nous discuterons des tarifs ensemble quand vous serez prêts.`;
    return { subject, html, text };
  }
  const subject = `Welcome to Vylan, ${opts.ownerName}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1e293b">
<p>Hi ${escapeHtml(opts.ownerName)},</p>
<p>Welcome to <strong>Vylan</strong> &mdash; the end of chasing your clients for documents.</p>
<p>Three things you can do in under five minutes:</p>
<ol style="padding-left:20px">
  <li style="margin-bottom:8px"><strong>Add your clients</strong> &mdash; import your existing CSV or add them one by one.</li>
  <li style="margin-bottom:8px"><strong>Create your first engagement</strong> &mdash; pick a template (T1, T2, bookkeeping) and send the magic link. Clients don't sign in to anything.</li>
  <li style="margin-bottom:8px"><strong>Let Vylan chase for you</strong> &mdash; smart reminders + AI flags when a client uploads the wrong slip.</li>
</ol>
<p style="margin:24px 0">
  <a href="${opts.appUrl}/dashboard" style="display:inline-block;background:#1e293b;color:#fafaf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">Open my overview</a>
</p>
<p style="color:#64748b;font-size:13px">You're in demo mode. No payment method required — we'll talk pricing together when you're ready.</p>
<p style="color:#64748b;font-size:13px">Question? Reply directly to this email.</p>
</body></html>`;
  const text = `Hi ${opts.ownerName},

Welcome to Vylan. Three things to do in under 5 min:
  1. Add your clients (CSV or one by one)
  2. Create your first engagement
  3. Let Vylan chase clients for you

Open your overview: ${opts.appUrl}/dashboard

You're in demo mode. No payment required to start.`;
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

// Default CTA / footer slate when the firm has no brand color set.
const DEFAULT_BRAND = "#1e293b";

export function buildReminderEmail(opts: {
  tone: ReminderTone;
  clientName: string;
  firmName: string;
  firmLogoUrl?: string | null;
  brandColor?: string | null;
  engagementTitle: string;
  url: string;
  dueDate: string | null;
  pendingRequiredCount: number;
  locale: "fr" | "en";
}): { subject: string; html: string; text: string } {
  const copy = COPY[opts.locale][opts.tone];
  const brand = sanitizeColor(opts.brandColor) ?? DEFAULT_BRAND;
  const subject = copy.subject(opts);
  const lines = copy.lines(opts);
  const greeting = copy.greeting(opts);

  const cta =
    opts.locale === "fr" ? "Téléverser mes documents" : "Upload my documents";
  const linkLabel =
    opts.locale === "fr"
      ? "Ou copiez ce lien dans votre navigateur :"
      : "Or copy this link into your browser:";
  const replyHint =
    opts.locale === "fr"
      ? "Une question ? Répondez simplement à ce courriel — la réponse va directement à votre comptable."
      : "Have a question? Just reply to this email — the answer goes straight to your accountant.";

  // The deadline + overdue tones surface the due date in a small pill
  // at the top so the date is unmissable even on a quick mobile glance.
  const dueDatePill =
    opts.dueDate && (opts.tone === "deadline" || opts.tone === "overdue")
      ? renderDueDatePill(opts.dueDate, opts.tone, opts.locale, brand)
      : "";

  // Logo-or-firmname header band so every reminder is visibly anchored
  // to the firm rather than feeling like a generic Vylan system email.
  const header = renderHeader(opts.firmLogoUrl, opts.firmName);

  // Body lines are joined into <p> blocks. One paragraph per line keeps
  // the rhythm consistent across all four tones.
  const bodyHtml = lines.html
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1e293b">${line}</p>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#1e293b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,0.06);overflow:hidden">
          <tr>
            <td style="padding:24px 28px 0 28px">
              ${header}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0 28px">
              ${dueDatePill}
              <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#1e293b">${escapeHtml(greeting)}</p>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 4px 28px">
              <a href="${opts.url}" style="display:inline-block;background-color:${brand};color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;line-height:1">${cta}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 0 28px">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b">${escapeHtml(linkLabel)}</p>
              <p style="margin:4px 0 0;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;color:#475569;word-break:break-all">${opts.url}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 24px 28px;border-top:1px solid #e2e8f0;margin-top:24px">
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#475569">${escapeHtml(replyHint)}</p>
              <p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#0f172a;font-weight:500">— ${escapeHtml(opts.firmName)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    greeting,
    "",
    ...lines.text,
    "",
    `${opts.locale === "fr" ? "Téléverser" : "Upload"}: ${opts.url}`,
    "",
    replyHint,
    "",
    `— ${opts.firmName}`,
  ].join("\n");

  return { subject, html, text };
}

// Reject anything that isn't a 3- or 6-digit hex colour. Falls back to
// the default slate elsewhere — keeps the firm's brand on the CTA when
// they set one, and never lets an arbitrary string slip into inline
// CSS and break email rendering.
function sanitizeColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  return null;
}

// Header band with the firm logo (when present) + firm name. When the
// firm has no logo we drop in just the name so the email still feels
// anchored to a real sender rather than an unattributed system blast.
function renderHeader(
  logoUrl: string | null | undefined,
  firmName: string,
): string {
  if (logoUrl) {
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
        <tr>
          <td style="padding-right:12px;vertical-align:middle">
            <img src="${logoUrl}" alt="${escapeHtml(firmName)}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:8px;object-fit:cover;border:0" />
          </td>
          <td style="vertical-align:middle">
            <div style="font-size:15px;font-weight:600;color:#0f172a">${escapeHtml(firmName)}</div>
          </td>
        </tr>
      </table>`;
  }
  return `<div style="margin:0 0 16px;font-size:15px;font-weight:600;color:#0f172a">${escapeHtml(firmName)}</div>`;
}

// Small coloured pill at the top of deadline / overdue reminders. Uses
// amber for "approaching" and red for "passed" so the urgency is
// visible at-a-glance even before the subject is parsed.
function renderDueDatePill(
  dueDate: string,
  tone: "deadline" | "overdue",
  locale: "fr" | "en",
  brand: string,
): string {
  void brand;
  const palette =
    tone === "overdue"
      ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" }
      : { bg: "#fef9c3", border: "#fde68a", text: "#854d0e" };
  const prefix =
    tone === "overdue"
      ? locale === "fr"
        ? "Échéance dépassée"
        : "Past deadline"
      : locale === "fr"
        ? "Échéance"
        : "Deadline";
  return `<div style="display:inline-block;background-color:${palette.bg};border:1px solid ${palette.border};color:${palette.text};border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;letter-spacing:0.02em;margin:0 0 12px">
  ${escapeHtml(prefix)} · ${escapeHtml(dueDate)}
</div>`;
}

type CopyVariant = {
  subject: (o: BuildOpts) => string;
  greeting: (o: BuildOpts) => string;
  lines: (o: BuildOpts) => { html: string[]; text: string[] };
};

type BuildOpts = Parameters<typeof buildReminderEmail>[0];

function plural(n: number, fr: boolean): string {
  if (fr) return n > 1 ? "documents" : "document";
  return n > 1 ? "documents" : "document";
}

const COPY: Record<"fr" | "en", Record<ReminderTone, CopyVariant>> = {
  fr: {
    gentle: {
      subject: (o) => `Petit rappel — ${o.engagementTitle}`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, true);
        return {
          html: [
            `Petit rappel : il nous manque encore <strong>${n} ${docs}</strong> pour finaliser <strong>${escapeHtml(o.engagementTitle)}</strong>.`,
            `Aucune urgence — dès que vous avez deux minutes, vous pouvez tout téléverser depuis votre téléphone.`,
          ],
          text: [
            `Petit rappel : il nous manque encore ${n} ${docs} pour finaliser ${o.engagementTitle}.`,
            `Aucune urgence — dès que vous avez deux minutes, vous pouvez tout téléverser depuis votre téléphone.`,
          ],
        };
      },
    },
    firm: {
      subject: (o) => `Documents toujours attendus — ${o.engagementTitle}`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, true);
        return {
          html: [
            `Cela fait une semaine que nous attendons <strong>${n} ${docs}</strong> pour <strong>${escapeHtml(o.engagementTitle)}</strong>.`,
            `Pourriez-vous nous les téléverser cette semaine ? Cela nous permettra d'avancer dans votre dossier sans accroc.`,
          ],
          text: [
            `Cela fait une semaine que nous attendons ${n} ${docs} pour ${o.engagementTitle}.`,
            `Pourriez-vous nous les téléverser cette semaine ? Cela nous permettra d'avancer dans votre dossier sans accroc.`,
          ],
        };
      },
    },
    deadline: {
      subject: (o) => `Échéance ${o.dueDate ?? "à venir"} — ${o.engagementTitle}`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, true);
        return {
          html: [
            `L'échéance pour <strong>${escapeHtml(o.engagementTitle)}</strong> approche et il nous manque encore <strong>${n} ${docs}</strong>.`,
            `Merci de les téléverser dès que possible pour éviter tout retard dans votre dossier.`,
          ],
          text: [
            `L'échéance pour ${o.engagementTitle} approche et il nous manque encore ${n} ${docs}.`,
            `Merci de les téléverser dès que possible pour éviter tout retard dans votre dossier.`,
          ],
        };
      },
    },
    overdue: {
      subject: (o) => `Échéance dépassée — ${o.engagementTitle}`,
      greeting: (o) => `Bonjour ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, true);
        return {
          html: [
            `L'échéance pour <strong>${escapeHtml(o.engagementTitle)}</strong> est passée et nous attendons toujours <strong>${n} ${docs}</strong>.`,
            `Dès qu'ils sont téléversés, nous reprenons le dossier immédiatement. Si vous rencontrez un problème, répondez à ce courriel — nous sommes là pour aider.`,
          ],
          text: [
            `L'échéance pour ${o.engagementTitle} est passée et nous attendons toujours ${n} ${docs}.`,
            `Dès qu'ils sont téléversés, nous reprenons le dossier immédiatement. Si vous rencontrez un problème, répondez à ce courriel — nous sommes là pour aider.`,
          ],
        };
      },
    },
  },
  en: {
    gentle: {
      subject: (o) => `Quick reminder — ${o.engagementTitle}`,
      greeting: (o) => `Hi ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, false);
        return {
          html: [
            `Quick reminder: we're still missing <strong>${n} ${docs}</strong> to wrap up <strong>${escapeHtml(o.engagementTitle)}</strong>.`,
            `No rush — whenever you have a couple of minutes, you can upload everything from your phone.`,
          ],
          text: [
            `Quick reminder: we're still missing ${n} ${docs} to wrap up ${o.engagementTitle}.`,
            `No rush — whenever you have a couple of minutes, you can upload everything from your phone.`,
          ],
        };
      },
    },
    firm: {
      subject: (o) => `Still waiting on documents — ${o.engagementTitle}`,
      greeting: (o) => `Hi ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, false);
        return {
          html: [
            `It's been a week and we're still waiting on <strong>${n} ${docs}</strong> for <strong>${escapeHtml(o.engagementTitle)}</strong>.`,
            `Could you upload them this week? That keeps your file moving without delays on our side.`,
          ],
          text: [
            `It's been a week and we're still waiting on ${n} ${docs} for ${o.engagementTitle}.`,
            `Could you upload them this week? That keeps your file moving without delays on our side.`,
          ],
        };
      },
    },
    deadline: {
      subject: (o) =>
        `Deadline ${o.dueDate ?? "approaching"} — ${o.engagementTitle}`,
      greeting: (o) => `Hi ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, false);
        return {
          html: [
            `The deadline for <strong>${escapeHtml(o.engagementTitle)}</strong> is coming up and we're still missing <strong>${n} ${docs}</strong>.`,
            `Please upload them as soon as you can so we have time to file on schedule.`,
          ],
          text: [
            `The deadline for ${o.engagementTitle} is coming up and we're still missing ${n} ${docs}.`,
            `Please upload them as soon as you can so we have time to file on schedule.`,
          ],
        };
      },
    },
    overdue: {
      subject: (o) => `Past deadline — ${o.engagementTitle}`,
      greeting: (o) => `Hi ${o.clientName},`,
      lines: (o) => {
        const n = o.pendingRequiredCount;
        const docs = plural(n, false);
        return {
          html: [
            `The deadline for <strong>${escapeHtml(o.engagementTitle)}</strong> has passed and we're still waiting on <strong>${n} ${docs}</strong>.`,
            `As soon as they're uploaded we'll pick the file back up. If something's blocking you, just reply to this email — we're happy to help.`,
          ],
          text: [
            `The deadline for ${o.engagementTitle} has passed and we're still waiting on ${n} ${docs}.`,
            `As soon as they're uploaded we'll pick the file back up. If something's blocking you, just reply to this email — we're happy to help.`,
          ],
        };
      },
    },
  },
};
