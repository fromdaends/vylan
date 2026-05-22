// Founder notifications for the public demo qualifying form.
//
// Sender model:
//   - The /demo form never fires emails directly. After every step
//     submission the row just sits with `notified_at IS NULL`.
//   - The /api/cron/demo-leads job runs every ~5 minutes, finds rows
//     where the prospect has been inactive for 5+ minutes, calls
//     notifyFounderLead() to send ONE consolidated email, and stamps
//     notified_at.
//   - When cal.com fires bookingSuccessful, markDemoBooked() calls
//     notifyFounderDemoBooked() immediately (real-time signal) and
//     stamps notified_at so the cron doesn't double-email.
//
// Exported entrypoints:
//   - notifyFounderLead          (cron — picks Qualified vs Partial)
//   - notifyFounderQualifiedLead (furthest_step = 3 path)
//   - notifyFounderPartialLead   (furthest_step < 3 path)
//   - notifyFounderDemoBooked    (cal.com booking confirmed)
//
// All are best-effort: failures log and return without throwing, so
// the form / booking flow never breaks because of a Resend hiccup.

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
// Qualified lead — prospect made it through all 3 steps. This email
// IS the founder's call-prep sheet, so it lists everything we know.
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
// Unified entry — the debounce cron calls this. Routes to the
// qualified-lead email for full step-3 fills, or to a "partial lead"
// email for prospects who bailed mid-form.
// ---------------------------------------------------------------------------

export async function notifyFounderLead(row: DemoRequest) {
  if (row.furthest_step === 3) {
    return notifyFounderQualifiedLead(row);
  }
  return notifyFounderPartialLead(row);
}

// ---------------------------------------------------------------------------
// Partial lead — prospect started the form but didn't make it to
// step 3. We send this 5+ minutes after their last activity so we
// don't fire prematurely while they're still typing.
// ---------------------------------------------------------------------------

export async function notifyFounderPartialLead(row: DemoRequest) {
  const to = founderEmail();
  const sizeLabel = row.firm_size ? fmt(row.firm_size, FIRM_SIZE_LABEL) : null;
  const subject = sizeLabel
    ? `Partial demo lead — ${row.firm_name ?? "(unknown firm)"} (${sizeLabel})`
    : `Partial demo lead — ${row.firm_name ?? "(unknown firm)"}`;

  const toolLabel = row.current_tool
    ? row.current_tool === "other_software" && row.current_tool_other
      ? `${fmt(row.current_tool, CURRENT_TOOL_LABEL)} — ${row.current_tool_other}`
      : fmt(row.current_tool, CURRENT_TOOL_LABEL)
    : null;

  const lines = [
    `A prospect started the demo form but didn't finish.`,
    `They reached step ${row.furthest_step} of 3.`,
    `Last activity: ${new Date(row.updated_at).toLocaleString("en-CA")}`,
    ``,
    `── Contact ──`,
    `Name:  ${row.contact_name ?? "—"}`,
    `Email: ${row.email}`,
    ``,
    `── Firm ──`,
    `Name:    ${row.firm_name ?? "—"}`,
    sizeLabel ? `Size:    ${sizeLabel}` : null,
    row.client_volume
      ? `Clients: ${fmt(row.client_volume, CLIENT_VOLUME_LABEL)}`
      : null,
    toolLabel ? `Tool:    ${toolLabel}` : null,
    ``,
    `You can still follow up at the email above.`,
    `Lead id: ${row.id}`,
  ].filter((l): l is string => l !== null);

  const contactRows: Array<[string, string, boolean?]> = [
    ["Name", row.contact_name ?? "—"],
    [
      "Email",
      `<a href="mailto:${encodeURIComponent(row.email)}">${escapeHtml(row.email)}</a>`,
      true,
    ],
  ];
  const firmRows: Array<[string, string, boolean?]> = [
    ["Name", row.firm_name ?? "—"],
  ];
  if (sizeLabel) firmRows.push(["Size", sizeLabel]);
  if (row.client_volume)
    firmRows.push(["Clients", fmt(row.client_volume, CLIENT_VOLUME_LABEL)]);
  if (toolLabel) firmRows.push(["Tool", toolLabel]);

  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <p style="margin:0 0 18px;font-size:14px;color:#475569">
        A prospect started the demo form but didn't finish. They reached step <strong>${row.furthest_step}</strong> of 3.
      </p>
      ${section("Contact", contactRows)}
      ${section("Firm", firmRows)}
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">
        You can still follow up at the email above.<br/>
        Last activity: ${escapeHtml(new Date(row.updated_at).toLocaleString("en-CA"))}<br/>
        Lead id: <code>${escapeHtml(row.id)}</code>
      </p>
    </div>
  `.trim();

  return sendEmail({ to, subject, text: lines.join("\n"), html });
}

// ---------------------------------------------------------------------------
// Booked — the lead fully converted (cal.com confirmed a slot).
// Fires immediately on booking and IS the call-prep sheet for a
// fast-booking prospect (they may never have triggered the regular
// qualified-lead cron email). Body is the full lead context PLUS a
// "booking confirmed" callout.
// ---------------------------------------------------------------------------

export async function notifyFounderDemoBooked(row: DemoRequest) {
  const to = founderEmail();
  const sizeLabel = fmt(row.firm_size, FIRM_SIZE_LABEL);
  const subject = `Demo BOOKED — ${row.firm_name ?? "(unknown firm)"} (${sizeLabel})`;

  const toolLabel =
    row.current_tool === "other_software" && row.current_tool_other
      ? `${fmt(row.current_tool, CURRENT_TOOL_LABEL)} — ${row.current_tool_other}`
      : fmt(row.current_tool, CURRENT_TOOL_LABEL);

  const text = [
    `${row.contact_name ?? row.email} booked a demo via cal.com.`,
    `Check cal.com for the exact slot.`,
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
    `Tool:    ${toolLabel}`,
    ``,
    `── Compliance ──`,
    `Marketing opt-in: ${row.marketing_opt_in ? "YES" : "no"}`,
    ``,
    `Lead id: ${row.id}`,
  ].join("\n");

  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <div style="background:#dcfce7;border-radius:10px;padding:14px 16px;margin:0 0 20px">
        <div style="font-weight:600;font-size:15px;color:#14532d;margin-bottom:4px">
          🎉 ${escapeHtml(row.contact_name ?? row.email)} booked a demo
        </div>
        <div style="font-size:13px;color:#166534">
          Check cal.com for the exact slot.
        </div>
      </div>
      ${section("Contact", [
        ["Name", row.contact_name ?? "—"],
        [
          "Email",
          `<a href="mailto:${encodeURIComponent(row.email)}">${escapeHtml(row.email)}</a>`,
          true,
        ],
        ["Phone", row.phone ?? "—"],
        ["Language", row.preferred_language ?? "—"],
        ["Province", row.province ?? "—"],
      ])}
      ${section("Firm", [
        ["Name", row.firm_name ?? "—"],
        ["Size", sizeLabel],
        ["Clients", fmt(row.client_volume, CLIENT_VOLUME_LABEL)],
        ["Tool", toolLabel],
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
