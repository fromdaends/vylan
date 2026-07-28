// Rendering for notification emails: one-off and digest.
//
// Layout intentionally mirrors src/lib/email.ts's internal (accountant-facing)
// templates: Vylan-branded rather than firm-branded, table-based for Outlook,
// inline styles only. These go to the FIRM's own people, so they carry Vylan's
// identity, not the client's.

import { escapeHtml } from "@/lib/email";
import {
  CATEGORY_LABELS,
  CHROME,
  copyFor,
  type CopyVars,
  type EmailLocale,
} from "./email-copy";
import { getNotificationEvent } from "./catalog";
import type { NotificationRow } from "@/lib/db/notifications";

const BRAND = "#1D3AFF";
const INK = "#1e293b";
const MUTED = "#64748b";

export type DetailLevel = "full" | "minimal";

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Where a notification points. Falls back to the dashboard rather than a dead
 * link if a payload is missing its href.
 */
export function hrefFor(row: NotificationRow): string {
  // Only an in-app path is ever accepted. Note the explicit "//" rejection:
  // a protocol-relative URL like //evil.test/x DOES start with "/", so a naive
  // startsWith check would happily paste an off-site link into an email.
  const fromPayload = row.payload?.href;
  if (
    typeof fromPayload === "string" &&
    fromPayload.startsWith("/") &&
    !fromPayload.startsWith("//")
  ) {
    return fromPayload;
  }
  switch (row.entity_type) {
    case "engagement":
      return row.entity_id ? `/engagements/${row.entity_id}` : "/dashboard";
    case "client":
      return row.entity_id ? `/clients/${row.entity_id}` : "/clients";
    case "invoice":
      return "/settings?tab=payments";
    default:
      return "/notifications";
  }
}

/**
 * Turn a stored payload into render variables, applying the recipient's detail
 * level. At `minimal` every identifying value is blanked BEFORE it reaches the
 * copy functions, so no template can leak a client name by accident. That is the
 * whole point of the setting: a firm picks it for a shared inbox or for Law 25
 * comfort, and a single careless template would defeat it.
 */
export function toCopyVars(
  row: NotificationRow,
  detailLevel: DetailLevel,
): CopyVars {
  const detailed = detailLevel === "full";
  const p = row.payload ?? {};
  const str = (k: string): string | null => {
    const v = p[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const count = typeof p.count === "number" && p.count > 0 ? Math.floor(p.count) : 1;
  return {
    clientName: detailed ? str("client_name") : null,
    engagementTitle: detailed ? str("engagement_title") : null,
    documentName: detailed ? str("document_name") : null,
    amount: detailed ? str("amount") : null,
    actorName: detailed ? str("actor_name") : null,
    count,
    detailed,
  };
}

export function headlineFor(
  row: NotificationRow,
  locale: EmailLocale,
  detailLevel: DetailLevel,
): string | null {
  const copy = copyFor(row.event_key, locale);
  if (!copy) return null;
  return copy.headline(toCopyVars(row, detailLevel));
}

function shell(locale: EmailLocale, inner: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,0.06);overflow:hidden">
        <tr><td style="padding:28px 28px 8px 28px">${inner}</td></tr>
        <tr><td style="padding:20px 28px 24px 28px;border-top:1px solid #e2e8f0">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:20px 0 4px">
  <a href="${url}" style="display:inline-block;background-color:${BRAND};color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;line-height:1">${escapeHtml(label)}</a>
</p>`;
}

// Footer: settings link, plus the per-event opt-out the spec asks for.
//
// The opt-out is a LOGGED-IN deep link into the Notifications tab with the event
// pre-selected, not a signed one-click token. A token that mutates preferences
// without a session is a real security surface (link forwarding, inbox scanners
// that prefetch every URL), and email scanners routinely GET every link in a
// message, which would silently switch people's notifications off. One click
// into an already-signed-in browser is the honest version.
function footerHtml(
  locale: EmailLocale,
  eventKey: string | null,
): string {
  const chrome = CHROME[locale];
  const settingsUrl = `${appUrl()}/${locale}/settings?tab=notifications`;
  const offUrl = eventKey
    ? `${settingsUrl}&event=${encodeURIComponent(eventKey)}`
    : settingsUrl;
  return `<p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED}">
  <a href="${settingsUrl}" style="color:${MUTED};text-decoration:underline">${escapeHtml(chrome.settingsLink)}</a>
  ${eventKey ? ` &nbsp;·&nbsp; <a href="${offUrl}" style="color:${MUTED};text-decoration:underline">${escapeHtml(chrome.turnOffLink)}</a>` : ""}
</p>
<p style="margin:10px 0 0;font-size:12px;color:${MUTED}">${escapeHtml(chrome.signoff)}</p>`;
}

function footerText(locale: EmailLocale, eventKey: string | null): string {
  const chrome = CHROME[locale];
  const settingsUrl = `${appUrl()}/${locale}/settings?tab=notifications`;
  const offUrl = eventKey
    ? `${settingsUrl}&event=${encodeURIComponent(eventKey)}`
    : settingsUrl;
  return [
    "",
    `${chrome.settingsLink}: ${settingsUrl}`,
    eventKey ? `${chrome.turnOffLink}: ${offUrl}` : "",
    "",
    chrome.signoff,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A single notification, sent on its own. */
export function buildNotificationEmail(opts: {
  row: NotificationRow;
  recipientName: string | null;
  locale: EmailLocale;
  detailLevel: DetailLevel;
}): { subject: string; html: string; text: string } | null {
  const copy = copyFor(opts.row.event_key, opts.locale);
  if (!copy) return null;
  const chrome = CHROME[opts.locale];
  const vars = toCopyVars(opts.row, opts.detailLevel);
  const headline = copy.headline(vars);
  const url = `${appUrl()}/${opts.locale}${hrefFor(opts.row)}`;

  // At `minimal` the body says nothing beyond "there's activity"; the headline
  // is already name-free because toCopyVars blanked the values.
  const bodyLine =
    opts.detailLevel === "minimal" ? chrome.minimalBody : headline;

  const inner = `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${INK}">${escapeHtml(chrome.greeting(opts.recipientName))}</p>
<p style="margin:0;font-size:17px;line-height:1.45;font-weight:600;color:${INK}">${escapeHtml(bodyLine)}</p>
${button(url, copy.cta)}`;

  const text = [
    chrome.greeting(opts.recipientName),
    "",
    bodyLine,
    "",
    `${copy.cta}: ${url}`,
    footerText(opts.locale, opts.row.event_key),
  ].join("\n");

  return {
    subject: opts.detailLevel === "minimal" ? chrome.minimalBody : headline,
    html: shell(
      opts.locale,
      inner,
      footerHtml(opts.locale, opts.row.event_key),
    ),
    text,
  };
}

/** Several notifications rolled into one digest, grouped by category. */
export function buildDigestEmail(opts: {
  rows: NotificationRow[];
  recipientName: string | null;
  locale: EmailLocale;
  detailLevel: DetailLevel;
}): { subject: string; html: string; text: string } | null {
  if (opts.rows.length === 0) return null;
  const chrome = CHROME[opts.locale];
  const labels = CATEGORY_LABELS[opts.locale];

  // Group by catalog category, preserving catalog order.
  const groups = new Map<string, NotificationRow[]>();
  for (const row of opts.rows) {
    const event = getNotificationEvent(row.event_key);
    if (!event) continue;
    const list = groups.get(event.category) ?? [];
    list.push(row);
    groups.set(event.category, list);
  }
  if (groups.size === 0) return null;

  const sections: string[] = [];
  const textSections: string[] = [];
  for (const [category, rows] of groups) {
    const items = rows
      .map((row) => {
        const line = headlineFor(row, opts.locale, opts.detailLevel);
        if (!line) return null;
        const url = `${appUrl()}/${opts.locale}${hrefFor(row)}`;
        return { line, url };
      })
      .filter((x): x is { line: string; url: string } => x !== null);
    if (items.length === 0) continue;

    sections.push(
      `<p style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED}">${escapeHtml(labels[category] ?? category)} (${items.length})</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${items
  .map(
    (i) =>
      `<tr><td style="padding:7px 0;border-bottom:1px solid #f1f5f9"><a href="${i.url}" style="color:${INK};text-decoration:none;font-size:15px;line-height:1.45">${escapeHtml(i.line)}</a></td></tr>`,
  )
  .join("\n")}
</table>`,
    );
    textSections.push(
      `${labels[category] ?? category} (${items.length})\n${items
        .map((i) => `  - ${i.line}\n    ${i.url}`)
        .join("\n")}`,
    );
  }
  if (sections.length === 0) return null;

  const total = opts.rows.length;
  const feedUrl = `${appUrl()}/${opts.locale}/notifications`;
  const inner = `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${INK}">${escapeHtml(chrome.greeting(opts.recipientName))}</p>
<p style="margin:0;font-size:15px;line-height:1.55;color:${INK}">${escapeHtml(
    opts.detailLevel === "minimal"
      ? chrome.minimalBody
      : chrome.digestIntro(total),
  )}</p>
${opts.detailLevel === "minimal" ? "" : sections.join("\n")}
${button(feedUrl, opts.locale === "fr" ? "Tout voir" : "See everything")}`;

  const text = [
    chrome.greeting(opts.recipientName),
    "",
    opts.detailLevel === "minimal"
      ? chrome.minimalBody
      : chrome.digestIntro(total),
    "",
    ...(opts.detailLevel === "minimal" ? [] : textSections),
    "",
    feedUrl,
    // A digest spans many event types, so there is no single "this type" to
    // switch off — the footer links to settings only.
    footerText(opts.locale, null),
  ].join("\n");

  return {
    subject: chrome.digestSubject(total),
    html: shell(opts.locale, inner, footerHtml(opts.locale, null)),
    text,
  };
}
