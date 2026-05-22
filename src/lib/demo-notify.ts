// Founder notifications for the public demo qualifying form.
//
// Three triggers wired by the form:
//   - notifyFounderNewLead       (step 1 submitted — prospect arrived)
//   - notifyFounderQualifiedLead (step 3 submitted — ready to book)
//   - notifyFounderDemoBooked    (cal.com booking confirmed)
//
// All three are best-effort: failures log and return null instead of
// throwing, so the form submission / booking flow itself never
// breaks because of a Resend hiccup.

import { sendEmail } from "@/lib/email";
import { brand } from "@/lib/brand";
import type { DemoRequest } from "@/lib/db/demo-requests";

// Founder's notification inbox. Falls back to brand.supportEmail so
// local dev doesn't need extra env vars to feel real.
function founderEmail(): string {
  return process.env.FOUNDER_NOTIFY_EMAIL?.trim() || brand.supportEmail;
}

// Bilingual-safe human labels for the qualifying-step values. Kept
// here (not in next-intl) because these strings appear in an email
// to the founder, not in the UI.
const FIRM_SIZE_LABEL: Record<string, string> = {
  solo: "Just me (solo)",
  "2_5": "2-5 people",
  "6_15": "6-15 people",
  "16_plus": "16+ people",
};
const CLIENT_VOLUME_LABEL: Record<string, string> = {
  under_25: "Under 25 clients",
  "25_100": "25-100 clients",
  "100_300": "100-300 clients",
  "300_plus": "300+ clients",
};
const CURRENT_TOOL_LABEL: Record<string, string> = {
  manual_email: "Email & manual",
  taxdome: "TaxDome",
  karbon: "Karbon",
  other_software: "Other software",
  nothing: "Nothing structured",
};

function fmt(label: string | null | undefined, map?: Record<string, string>) {
  if (!label) return "—";
  if (!map) return label;
  return map[label] ?? label;
}

// ---------------------------------------------------------------------------
// Step 1 — prospect just landed in the funnel
// ---------------------------------------------------------------------------

export async function notifyFounderNewLead(row: DemoRequest) {
  const to = founderEmail();
  const subject = `New demo lead — ${row.firm_name ?? "(unknown firm)"}`;

  const text = [
    `A prospect just started the demo form.`,
    ``,
    `Contact: ${row.contact_name ?? "—"}`,
    `Email:   ${row.email}`,
    `Firm:    ${row.firm_name ?? "—"}`,
    ``,
    `They have not yet completed the qualifying questions. If they`,
    `don't, you can still follow up at the email above.`,
    ``,
    `When: ${new Date(row.created_at).toLocaleString("en-CA")}`,
    `Lead id: ${row.id}`,
  ].join("\n");

  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <p style="margin:0 0 16px;font-size:14px;color:#475569">
        A prospect just started the demo form.
      </p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 16px 6px 0;color:#64748b;width:90px">Contact</td><td>${escapeHtml(row.contact_name ?? "—")}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Email</td><td><a href="mailto:${encodeURIComponent(row.email)}">${escapeHtml(row.email)}</a></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Firm</td><td>${escapeHtml(row.firm_name ?? "—")}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">
        They have not yet completed the qualifying questions. If they don't, you can still follow up at the email above.<br/>
        Lead id: <code>${escapeHtml(row.id)}</code>
      </p>
    </div>
  `.trim();

  return sendEmail({ to, subject, text, html });
}

// ---------------------------------------------------------------------------
// Step 3 — qualified, ready to book. This email IS the founder's
// call-prep sheet, so it lists everything we know.
// ---------------------------------------------------------------------------

export async function notifyFounderQualifiedLead(row: DemoRequest) {
  const to = founderEmail();
  const sizeLabel = fmt(row.firm_size, FIRM_SIZE_LABEL);
  const subject = `Qualified demo lead — ${row.firm_name ?? "(unknown firm)"} (${sizeLabel})`;

  const tool = fmt(row.current_tool, CURRENT_TOOL_LABEL);
  const toolDetail =
    row.current_tool === "other_software" && row.current_tool_other
      ? `${tool} — ${row.current_tool_other}`
      : tool;

  const lines = [
    `Qualified demo lead. They have NOT booked yet — that happens next via cal.com.`,
    ``,
    `── Contact ──`,
    `Name:  ${row.contact_name ?? "—"}`,
    `Email: ${row.email}`,
    `Phone: ${row.phone ?? "—"}`,
    `Lang:  ${row.preferred_language ?? "—"}`,
    `Prov:  ${row.province ?? "—"}`,
    ``,
    `── Firm ──`,
    `Name:    ${row.firm_name ?? "—"}`,
    `Size:    ${sizeLabel}`,
    `Clients: ${fmt(row.client_volume, CLIENT_VOLUME_LABEL)}`,
    `Tool:    ${toolDetail}`,
    ``,
    `── Compliance ──`,
    `Marketing opt-in: ${row.marketing_opt_in ? "YES" : "no"}`,
    ``,
    `Lead id: ${row.id}`,
    `Submitted: ${new Date(row.updated_at).toLocaleString("en-CA")}`,
  ];

  const text = lines.join("\n");
  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <p style="margin:0 0 20px;font-size:14px;color:#475569">
        Qualified demo lead. They have <strong>not</strong> booked yet — that happens next via cal.com.
      </p>
      ${section("Contact", [
        ["Name", row.contact_name ?? "—"],
        ["Email", `<a href="mailto:${encodeURIComponent(row.email)}">${escapeHtml(row.email)}</a>`, true],
        ["Phone", row.phone ?? "—"],
        ["Language", row.preferred_language ?? "—"],
        ["Province", row.province ?? "—"],
      ])}
      ${section("Firm", [
        ["Name", row.firm_name ?? "—"],
        ["Size", sizeLabel],
        ["Clients", fmt(row.client_volume, CLIENT_VOLUME_LABEL)],
        ["Tool", toolDetail],
      ])}
      ${section("Compliance", [
        [
          "Marketing opt-in",
          row.marketing_opt_in
            ? '<span style="color:#15803d;font-weight:600">YES</span>'
            : '<span style="color:#64748b">no</span>',
          true,
        ],
      ])}
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">
        Lead id: <code>${escapeHtml(row.id)}</code><br/>
        Submitted: ${escapeHtml(new Date(row.updated_at).toLocaleString("en-CA"))}
      </p>
    </div>
  `.trim();

  return sendEmail({ to, subject, text, html });
}

// ---------------------------------------------------------------------------
// Booked — the lead fully converted (cal.com confirmed a slot)
// ---------------------------------------------------------------------------

export async function notifyFounderDemoBooked(row: DemoRequest) {
  const to = founderEmail();
  const subject = `Demo booked — ${row.firm_name ?? "(unknown firm)"}`;
  const text = [
    `${row.contact_name ?? row.email} just booked their demo via cal.com.`,
    ``,
    `Firm:  ${row.firm_name ?? "—"}`,
    `Email: ${row.email}`,
    `Phone: ${row.phone ?? "—"}`,
    ``,
    `Check cal.com for the exact slot.`,
    `Lead id: ${row.id}`,
  ].join("\n");
  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <p style="margin:0 0 16px;font-size:14px">
        <strong>${escapeHtml(row.contact_name ?? row.email)}</strong>
        just booked their demo via cal.com.
      </p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 16px 6px 0;color:#64748b;width:90px">Firm</td><td>${escapeHtml(row.firm_name ?? "—")}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Email</td><td><a href="mailto:${encodeURIComponent(row.email)}">${escapeHtml(row.email)}</a></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Phone</td><td>${escapeHtml(row.phone ?? "—")}</td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">
        Check cal.com for the exact slot.<br/>
        Lead id: <code>${escapeHtml(row.id)}</code>
      </p>
    </div>
  `.trim();
  return sendEmail({ to, subject, text, html });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function section(
  title: string,
  rows: Array<[label: string, value: string, raw?: boolean]>,
): string {
  const body = rows
    .map(
      ([label, value, raw]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#64748b;width:130px;vertical-align:top">${escapeHtml(
          label,
        )}</td><td>${raw ? value : escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `
    <div style="margin:0 0 18px">
      <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:11px;color:#64748b;font-weight:600;margin:0 0 8px">${escapeHtml(title)}</div>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;width:100%">${body}</table>
    </div>
  `;
}
