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
// Industry is stored in the row's `practice_type` column (see saveDemoStep).
// For the "other" choice we store the prospect's free text, so an unmapped
// value falls through to the raw string — exactly what we want to show.
const INDUSTRY_LABEL: Record<string, string> = {
  accounting: "Accounting / bookkeeping",
  legal: "Legal / law firm",
  real_estate: "Property management / real estate",
  financial: "Financial services / insurance",
  healthcare: "Healthcare / clinic",
  construction: "Construction / trades",
  other: "Other",
};

function fmt(label: string | null | undefined, map?: Record<string, string>) {
  if (!label) return "—";
  if (!map) return label;
  return map[label] ?? label;
}

// ---------------------------------------------------------------------------
// Lead quality heuristic
// ---------------------------------------------------------------------------
//
// Cheap rule-based assessment of a demo_requests row, surfaced in the
// founder notification email so leads can be triaged from the inbox.
// Deliberately permissive — never BLOCKS submissions, just flags.
// False-positives are cheap (founder eyeballs and dismisses), false-
// negatives are cheap (founder sees a fine lead and replies).
//
// Tiers:
//   ok          — no concerns, treat normally
//   suspicious  — one or two soft signals (free email, short name, etc.)
//   likely_junk — disposable email or multiple junk signals stacked
//
// Heuristics are intentionally simple. When real spam volume hits, add
// proper checks (DNS MX lookup, double opt-in email verification, etc.)
// — see the conversation that introduced this module.

type LeadQuality = {
  tier: "ok" | "suspicious" | "likely_junk";
  flags: string[];
};

// Known throwaway / disposable email domains. Tiny inline list — when
// volume justifies it, swap for the `disposable-email-domains` npm
// package (~3500 entries, well maintained).
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "yopmail.com",
  "yopmail.fr",
  "trashmail.com",
  "trashmail.net",
  "tempmail.com",
  "tempmail.net",
  "temp-mail.org",
  "mintemail.com",
  "throwawaymail.com",
  "fakeinbox.com",
  "getnada.com",
  "maildrop.cc",
  "moakt.com",
  "dispostable.com",
  "example.com",
  "example.org",
  "example.net",
  "test.com",
]);

// Free consumer providers — NOT junk on their own (lots of solo
// accountants use gmail) but combined with other signals it's weaker.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.ca",
  "yahoo.fr",
  "hotmail.com",
  "hotmail.ca",
  "hotmail.fr",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
]);

// Local parts that scream "fake" — these are the most common test /
// keyboard-mash values. Case-insensitive exact match on the local part.
const JUNK_LOCAL_PARTS = new Set([
  "test",
  "tester",
  "test1",
  "test2",
  "asdf",
  "asdfasdf",
  "qwerty",
  "qwertyuiop",
  "abc",
  "abcdef",
  "xxx",
  "noreply",
  "nobody",
  "admin",
  "spam",
  "fake",
  "fakeemail",
]);

function looksLikeKeyboardMash(s: string): boolean {
  const lower = s.toLowerCase().trim();
  if (lower.length === 0) return false;
  // 4+ consecutive identical characters → "aaaaaa", "11111"
  if (/(.)\1{3,}/.test(lower)) return true;
  // No vowels at all and 4+ chars → "qrtsfg", "zxcvbn"
  if (lower.length >= 4 && !/[aeiouyàâéèêëîïôöùûü]/.test(lower)) return true;
  return false;
}

export function assessLeadQuality(row: DemoRequest): LeadQuality {
  const flags: string[] = [];
  let weight = 0; // 0 = clean, 1-2 = suspicious, 3+ = likely junk

  const email = (row.email ?? "").toLowerCase().trim();
  const atIdx = email.lastIndexOf("@");
  const localPart = atIdx > 0 ? email.slice(0, atIdx) : "";
  const domain = atIdx > 0 ? email.slice(atIdx + 1) : "";

  if (domain && DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    flags.push(`disposable email domain (${domain})`);
    weight += 3;
  }
  if (localPart && JUNK_LOCAL_PARTS.has(localPart)) {
    flags.push(`generic / placeholder email local-part ("${localPart}")`);
    weight += 2;
  }
  if (localPart && looksLikeKeyboardMash(localPart)) {
    flags.push("email local-part looks like keyboard mash");
    weight += 2;
  }
  if (domain && FREE_EMAIL_DOMAINS.has(domain)) {
    // Soft signal — common for solo accountants. Only weight if
    // OTHER signals already exist.
    if (weight > 0) {
      flags.push(`free email provider (${domain})`);
      weight += 1;
    }
  }

  // Name checks
  const name = (row.contact_name ?? "").trim();
  if (name.length > 0 && name.length < 3) {
    flags.push(`contact name very short ("${name}")`);
    weight += 1;
  }
  if (name && looksLikeKeyboardMash(name)) {
    flags.push("contact name looks like keyboard mash");
    weight += 2;
  }
  // Single word name (no surname) — soft signal only
  if (name && !name.includes(" ") && weight > 0) {
    flags.push("contact name is a single word");
    weight += 1;
  }

  // Firm name checks (only for full / qualified leads — partial leads
  // might just not have got there yet)
  if (row.furthest_step === 3) {
    const firm = (row.firm_name ?? "").trim();
    if (firm && firm.length < 3) {
      flags.push(`firm name very short ("${firm}")`);
      weight += 1;
    }
    if (firm && looksLikeKeyboardMash(firm)) {
      flags.push("firm name looks like keyboard mash");
      weight += 2;
    }
    // Firm name identical to contact name — sometimes legit (solo
    // practice using own name as brand) but a flag worth seeing
    if (firm && name && firm.toLowerCase() === name.toLowerCase()) {
      flags.push("firm name is identical to contact name");
      weight += 1;
    }
  }

  const tier: LeadQuality["tier"] =
    weight === 0 ? "ok" : weight >= 3 ? "likely_junk" : "suspicious";
  return { tier, flags };
}

function qualityPrefix(tier: LeadQuality["tier"]): string {
  if (tier === "likely_junk") return "[junk?] ";
  if (tier === "suspicious") return "[?] ";
  return "";
}

function qualityHtmlBlock(quality: LeadQuality): string {
  if (quality.tier === "ok") return "";
  const palette =
    quality.tier === "likely_junk"
      ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", label: "#7f1d1d" }
      : { bg: "#fef9c3", border: "#fde68a", text: "#854d0e", label: "#713f12" };
  const label =
    quality.tier === "likely_junk" ? "Likely junk" : "Suspicious";
  const items = quality.flags
    .map((f) => `<li style="margin:2px 0">${escapeHtml(f)}</li>`)
    .join("");
  return `
    <div style="background:${palette.bg};border:1px solid ${palette.border};border-radius:10px;padding:12px 14px;margin:0 0 16px">
      <div style="font-weight:600;font-size:13px;color:${palette.label};margin:0 0 6px">
        ${label}
      </div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:${palette.text}">
        ${items}
      </ul>
    </div>
  `;
}

function qualityTextBlock(quality: LeadQuality): string {
  if (quality.tier === "ok") return "";
  const label =
    quality.tier === "likely_junk"
      ? "── Quality: LIKELY JUNK ──"
      : "── Quality: SUSPICIOUS ──";
  const items = quality.flags.map((f) => `  • ${f}`).join("\n");
  return `${label}\n${items}\n\n`;
}

// ---------------------------------------------------------------------------
// Qualified lead — prospect made it through all 3 steps. This email
// IS the founder's call-prep sheet, so it lists everything we know.
// ---------------------------------------------------------------------------

export async function notifyFounderQualifiedLead(row: DemoRequest) {
  const to = founderEmail();
  const sizeLabel = fmt(row.firm_size, FIRM_SIZE_LABEL);
  const quality = assessLeadQuality(row);
  const subject = `${qualityPrefix(quality.tier)}Qualified demo lead — ${row.firm_name ?? "(unknown firm)"} (${sizeLabel})`;

  const tool = fmt(row.current_tool, CURRENT_TOOL_LABEL);
  const toolDetail =
    row.current_tool === "other_software" && row.current_tool_other
      ? `${tool} — ${row.current_tool_other}`
      : tool;

  const lines = [
    `Qualified demo lead. They have NOT booked yet — that happens next via cal.com.`,
    ``,
    qualityTextBlock(quality),
    `── Contact ──`,
    `Name:  ${row.contact_name ?? "—"}`,
    `Email: ${row.email}`,
    `Phone: ${row.phone ?? "—"}`,
    `Lang:  ${row.preferred_language ?? "—"}`,
    `Prov:  ${row.province ?? "—"}`,
    ``,
    `── Firm ──`,
    `Name:     ${row.firm_name ?? "—"}`,
    `Industry: ${fmt(row.practice_type, INDUSTRY_LABEL)}`,
    `Size:     ${sizeLabel}`,
    `Clients:  ${fmt(row.client_volume, CLIENT_VOLUME_LABEL)}`,
    `Tool:     ${toolDetail}`,
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
      ${qualityHtmlBlock(quality)}
      ${section("Contact", [
        ["Name", row.contact_name ?? "—"],
        ["Email", `<a href="mailto:${encodeURIComponent(row.email)}">${escapeHtml(row.email)}</a>`, true],
        ["Phone", row.phone ?? "—"],
        ["Language", row.preferred_language ?? "—"],
        ["Province", row.province ?? "—"],
      ])}
      ${section("Firm", [
        ["Name", row.firm_name ?? "—"],
        ["Industry", fmt(row.practice_type, INDUSTRY_LABEL)],
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
  const quality = assessLeadQuality(row);
  const prefix = qualityPrefix(quality.tier);
  const subject = sizeLabel
    ? `${prefix}Partial demo lead — ${row.firm_name ?? "(unknown firm)"} (${sizeLabel})`
    : `${prefix}Partial demo lead — ${row.firm_name ?? "(unknown firm)"}`;

  const toolLabel = row.current_tool
    ? row.current_tool === "other_software" && row.current_tool_other
      ? `${fmt(row.current_tool, CURRENT_TOOL_LABEL)} — ${row.current_tool_other}`
      : fmt(row.current_tool, CURRENT_TOOL_LABEL)
    : null;
  const industryLabel = row.practice_type
    ? fmt(row.practice_type, INDUSTRY_LABEL)
    : null;

  const lines = [
    `A prospect started the demo form but didn't finish.`,
    `They reached step ${row.furthest_step} of 3.`,
    `Last activity: ${new Date(row.updated_at).toLocaleString("en-CA")}`,
    ``,
    qualityTextBlock(quality),
    `── Contact ──`,
    `Name:  ${row.contact_name ?? "—"}`,
    `Email: ${row.email}`,
    ``,
    `── Firm ──`,
    `Name:     ${row.firm_name ?? "—"}`,
    industryLabel ? `Industry: ${industryLabel}` : null,
    sizeLabel ? `Size:     ${sizeLabel}` : null,
    row.client_volume
      ? `Clients:  ${fmt(row.client_volume, CLIENT_VOLUME_LABEL)}`
      : null,
    toolLabel ? `Tool:     ${toolLabel}` : null,
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
  if (industryLabel) firmRows.push(["Industry", industryLabel]);
  if (sizeLabel) firmRows.push(["Size", sizeLabel]);
  if (row.client_volume)
    firmRows.push(["Clients", fmt(row.client_volume, CLIENT_VOLUME_LABEL)]);
  if (toolLabel) firmRows.push(["Tool", toolLabel]);

  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <p style="margin:0 0 18px;font-size:14px;color:#475569">
        A prospect started the demo form but didn't finish. They reached step <strong>${row.furthest_step}</strong> of 3.
      </p>
      ${qualityHtmlBlock(quality)}
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
    `Name:     ${row.firm_name ?? "—"}`,
    `Industry: ${fmt(row.practice_type, INDUSTRY_LABEL)}`,
    `Size:     ${sizeLabel}`,
    `Clients:  ${fmt(row.client_volume, CLIENT_VOLUME_LABEL)}`,
    `Tool:     ${toolLabel}`,
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
        ["Industry", fmt(row.practice_type, INDUSTRY_LABEL)],
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
// New demo signup — fires when a prospect finishes creating their (demo)
// account. Unlike the lead emails above, an account now EXISTS, so this
// carries the two things needed to bill them in Stripe: the owner's login
// email (the webhook's match key) and the firm ID (the metadata fallback when
// the billing email differs from the login email). Best-effort.
// ---------------------------------------------------------------------------

export async function notifyFounderNewSignup(params: {
  firmId: string;
  firmName: string;
  ownerName: string;
  ownerEmail: string;
}): Promise<void> {
  const to = founderEmail();
  const subject = `New demo signup — ${params.firmName}`;

  const text = [
    `A new demo account just finished signing up.`,
    ``,
    `── Account ──`,
    `Firm:        ${params.firmName}`,
    `Owner:       ${params.ownerName}`,
    `Login email: ${params.ownerEmail}`,
    `Firm ID:     ${params.firmId}`,
    ``,
    `── To activate them after they pay ──`,
    `In Stripe, create a customer with the LOGIN EMAIL above (that's how the`,
    `payment is matched to this account), then send the invoice/subscription.`,
    `If you must use a different billing email, instead add this metadata to`,
    `the invoice/subscription:  firm_id = ${params.firmId}`,
  ].join("\n");

  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;max-width:560px">
      <p style="margin:0 0 18px;font-size:14px;color:#475569">
        A new <strong>demo account</strong> just finished signing up.
      </p>
      ${section("Account", [
        ["Firm", params.firmName],
        ["Owner", params.ownerName],
        [
          "Login email",
          `<a href="mailto:${encodeURIComponent(params.ownerEmail)}">${escapeHtml(params.ownerEmail)}</a>`,
          true,
        ],
        ["Firm ID", `<code>${escapeHtml(params.firmId)}</code>`, true],
      ])}
      <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;margin:4px 0 0;font-size:13px;color:#475569;line-height:1.5">
        <strong style="color:#0f172a">To activate them after they pay:</strong>
        in Stripe, create a customer with the <strong>login email</strong> above
        (that's how the payment is matched to this account), then send the
        invoice/subscription. If the billing email must differ, instead add
        <code>firm_id = ${escapeHtml(params.firmId)}</code> as metadata on the
        invoice/subscription.
      </div>
    </div>
  `.trim();

  try {
    await sendEmail({ to, subject, text, html });
  } catch (e) {
    console.error("[notifyFounderNewSignup] failed:", e);
  }
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
