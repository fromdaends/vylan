#!/usr/bin/env node
/* eslint-disable */
//
// Seeds a batch of realistic-looking demo data into your firm so you
// can poke around the app with a populated dashboard, /clients, and
// engagements list. Creates:
//
//   - 10 clients (mix of individual + business, fr + en, with notes/ext refs)
//   - ~15 engagements across those clients in various states:
//       * 2 draft (not yet sent)
//       * 4 sent (recent, no client activity yet)
//       * 4 in_progress (one overdue, one due-soon, one stale, one healthy)
//       * 2 ready-to-review (all required items submitted)
//       * 2 complete (recent)
//       * 1 cancelled
//   - ~70 request items across those engagements, with realistic doc
//     types (T4, RL-1, T5, RRSP, bank statements, etc.) and a mix of
//     statuses (pending / submitted / approved) so /dashboard's
//     "Needs attention" + "Ready to review" sections actually have rows.
//
// All clients get a `Demo:` prefix in display_name so they're easy to
// spot in /clients and easy to wipe later.
//
// NO uploaded files are created — that would require generating real
// PDFs/images and uploading to Supabase Storage. If you want a single
// end-to-end uploaded-file test, use scripts/seed-ai-test.mjs instead.
//
// Usage (from the project root, on your Mac):
//
//   1. Pull production env vars into a local file:
//        npx vercel env pull .env.test
//
//   2. Seed:
//        node --env-file=.env.test scripts/seed-demo-data.mjs your@email.com
//
//   3. Wipe (deletes every client with the Demo: prefix in your firm,
//      cascading to engagements/items/uploads):
//        node --env-file=.env.test scripts/seed-demo-data.mjs --wipe your@email.com
//
// Idempotency: re-running without --wipe APPENDS more demo data. Wipe
// first if you want a clean slate.

import { createClient } from "@supabase/supabase-js";

const DEMO_PREFIX = "Demo: ";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Did you run `npx vercel env pull .env.test` first?",
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const wipeMode = args.includes("--wipe");
const email = args.find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Usage: node --env-file=.env.test scripts/seed-demo-data.mjs your@email.com");
  console.error("       node --env-file=.env.test scripts/seed-demo-data.mjs --wipe your@email.com");
  process.exit(1);
}

if (wipeMode) {
  await wipe(email);
} else {
  await seed(email);
}

// ─────────────────────────────────────────────────────────────────────
// SEED
// ─────────────────────────────────────────────────────────────────────

async function seed(accountantEmail) {
  const firm = await findFirm(accountantEmail);
  console.log(`✓ Found firm ${firm.id} for ${accountantEmail}`);

  // 1. Insert clients.
  const clientRows = CLIENTS.map((c) => ({
    firm_id: firm.id,
    type: c.type,
    display_name: `${DEMO_PREFIX}${c.name}`,
    email: c.email,
    phone: c.phone ?? null,
    locale: c.locale,
    external_ref: c.external_ref ?? null,
    notes: c.notes ?? null,
  }));
  const { data: clients, error: cErr } = await sb
    .from("clients")
    .insert(clientRows)
    .select("id, display_name, type, locale");
  if (cErr) throw cErr;
  console.log(`✓ Inserted ${clients.length} demo clients`);

  // 2. Build engagements. Each ENGAGEMENT_SPEC picks a client by index.
  const now = new Date();
  const engagementRows = ENGAGEMENT_SPECS.map((spec) => {
    const client = clients[spec.clientIdx];
    const dueDate = spec.dueOffsetDays != null
      ? offsetDate(now, spec.dueOffsetDays).toISOString().slice(0, 10)
      : null;
    const sentAt = spec.sentOffsetDays != null
      ? offsetDate(now, spec.sentOffsetDays).toISOString()
      : null;
    const completedAt = spec.status === "complete"
      ? offsetDate(now, spec.completedOffsetDays ?? -3).toISOString()
      : null;
    return {
      firm_id: firm.id,
      client_id: client.id,
      title: spec.title,
      type: spec.type,
      status: spec.status,
      due_date: dueDate,
      sent_at: sentAt,
      completed_at: completedAt,
      magic_token: spec.status === "draft" ? null : generateMagicToken(),
      magic_expires_at: spec.status === "draft"
        ? null
        : offsetDate(now, 90).toISOString(),
    };
  });
  const { data: engagements, error: eErr } = await sb
    .from("engagements")
    .insert(engagementRows)
    .select("id, status, title");
  if (eErr) throw eErr;
  console.log(`✓ Inserted ${engagements.length} demo engagements`);

  // 3. Build request items, one batch per engagement, varying by spec.
  let itemTotal = 0;
  for (let i = 0; i < engagements.length; i++) {
    const eng = engagements[i];
    const spec = ENGAGEMENT_SPECS[i];
    const items = spec.items.map((it, idx) => ({
      engagement_id: eng.id,
      label: it.label,
      label_fr: it.label_fr,
      description: it.description ?? null,
      description_fr: it.description_fr ?? null,
      doc_type: it.doc_type,
      required: it.required ?? true,
      order_index: idx,
      status: it.status ?? "pending",
      approved_at: it.status === "approved"
        ? offsetDate(now, -2).toISOString()
        : null,
    }));
    const { error: iErr } = await sb.from("request_items").insert(items);
    if (iErr) throw iErr;
    itemTotal += items.length;
  }
  console.log(`✓ Inserted ${itemTotal} demo request items`);

  // 4. Summary.
  const byStatus = engagements.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});
  console.log("\n=== SEEDED ===");
  console.log(`Clients:     ${clients.length}`);
  console.log(`Engagements: ${engagements.length}`, byStatus);
  console.log(`Items:       ${itemTotal}`);
  console.log("\nOpen your dashboard — the Needs attention + Ready to review");
  console.log("sections should now have rows. Wipe when you're done:");
  console.log(`  node --env-file=.env.test scripts/seed-demo-data.mjs --wipe ${accountantEmail}`);
}

// ─────────────────────────────────────────────────────────────────────
// WIPE
// ─────────────────────────────────────────────────────────────────────

async function wipe(accountantEmail) {
  const firm = await findFirm(accountantEmail);

  const { data: clients, error: findErr } = await sb
    .from("clients")
    .select("id, display_name")
    .eq("firm_id", firm.id)
    .like("display_name", `${DEMO_PREFIX}%`);
  if (findErr) throw findErr;
  if (!clients?.length) {
    console.log(`Nothing to wipe — no clients with prefix "${DEMO_PREFIX}" in firm ${firm.id}.`);
    return;
  }
  const ids = clients.map((c) => c.id);
  const { error: delErr } = await sb.from("clients").delete().in("id", ids);
  if (delErr) throw delErr;
  console.log(
    `✓ Deleted ${ids.length} demo client(s) and all their engagements/items (cascade).`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function findFirm(accountantEmail) {
  const { data: userRow, error } = await sb
    .from("users")
    .select("id, firm_id, email")
    .eq("email", accountantEmail)
    .maybeSingle();
  if (error) throw error;
  if (!userRow?.firm_id) {
    console.error(`No user with email ${accountantEmail} found.`);
    process.exit(1);
  }
  return { id: userRow.firm_id };
}

function offsetDate(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function generateMagicToken() {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────

const CLIENTS = [
  {
    type: "individual",
    name: "Jean-François Bouchard",
    email: "jf.bouchard@example.com",
    phone: "+15145557101",
    locale: "fr",
    notes: "Locataire — deux T4 cette année",
  },
  {
    type: "individual",
    name: "Marie-Claude Pelletier",
    email: "mc.pelletier@example.com",
    phone: "+14185557102",
    locale: "fr",
  },
  {
    type: "individual",
    name: "Sébastien Tremblay",
    email: "s.tremblay@example.com",
    phone: "+15145557103",
    locale: "fr",
    external_ref: "ST-2025",
  },
  {
    type: "individual",
    name: "Catherine Lavoie",
    email: "c.lavoie@example.com",
    phone: "+15145557104",
    locale: "fr",
  },
  {
    type: "individual",
    name: "Emma Wright",
    email: "emma.wright@example.com",
    phone: "+15145557105",
    locale: "en",
    notes: "Anglophone — expat from Toronto",
  },
  {
    type: "individual",
    name: "David Chen",
    email: "david.chen@example.com",
    phone: "+15145557106",
    locale: "en",
  },
  {
    type: "business",
    name: "Boulangerie du Quartier Inc.",
    email: "compta@boulangerie.example.com",
    phone: "+15145557201",
    locale: "fr",
    external_ref: "BQ-INC",
    notes: "Fin d'année 31 décembre",
  },
  {
    type: "business",
    name: "Garage Plamondon Auto",
    email: "compta@garageplamondon.example.com",
    phone: "+14185557202",
    locale: "fr",
    notes: "Tenue de livres mensuelle",
  },
  {
    type: "business",
    name: "Construction Lafleur Inc.",
    email: "compta@lafleurconstruction.example.com",
    phone: "+14505557203",
    locale: "fr",
    external_ref: "CL-INC",
  },
  {
    type: "business",
    name: "Northern Lights Bakery Inc.",
    email: "accounts@northernlights.example.com",
    phone: "+15145557204",
    locale: "en",
    external_ref: "NL-INC",
  },
];

// Reusable item templates.
const T1_ITEMS = [
  {
    label: "T4 Slip",
    label_fr: "Feuillet T4",
    description: "Employment income for the tax year.",
    description_fr: "Revenu d'emploi pour l'année fiscale.",
    doc_type: "t4",
    required: true,
  },
  {
    label: "RL-1 Slip",
    label_fr: "Relevé 1",
    description: "Quebec employment income equivalent of T4.",
    description_fr: "Équivalent québécois du T4.",
    doc_type: "rl1",
    required: true,
  },
  {
    label: "T5 Slip",
    label_fr: "Feuillet T5",
    description: "Investment income (interest, dividends).",
    description_fr: "Revenus de placement (intérêts, dividendes).",
    doc_type: "t5",
    required: false,
  },
  {
    label: "RRSP Contribution Receipt",
    label_fr: "Reçu de cotisation REER",
    doc_type: "rrsp",
    required: false,
  },
  {
    label: "Medical Expenses",
    label_fr: "Frais médicaux",
    doc_type: "medical",
    required: false,
  },
  {
    label: "Charitable Donation Receipts",
    label_fr: "Reçus de dons de bienfaisance",
    doc_type: "donation",
    required: false,
  },
];

const T2_ITEMS = [
  {
    label: "Trial Balance",
    label_fr: "Balance de vérification",
    doc_type: "trial_balance",
    required: true,
  },
  {
    label: "General Ledger Export",
    label_fr: "Export du grand livre",
    doc_type: "gl_export",
    required: true,
  },
  {
    label: "Bank Statements (12 months)",
    label_fr: "Relevés bancaires (12 mois)",
    doc_type: "bank_statement",
    required: true,
  },
  {
    label: "GST/HST/QST Filings",
    label_fr: "Déclarations TPS/TVH/TVQ",
    doc_type: "gst_hst_qst",
    required: true,
  },
  {
    label: "Payroll Summary",
    label_fr: "Sommaire de la paie",
    doc_type: "payroll_summary",
    required: false,
  },
  {
    label: "Capital Asset Additions",
    label_fr: "Ajouts d'immobilisations",
    doc_type: "capital_asset",
    required: false,
  },
];

const BOOKKEEPING_ITEMS = [
  {
    label: "Bank Statement",
    label_fr: "Relevé bancaire",
    doc_type: "bank_statement",
    required: true,
  },
  {
    label: "Credit Card Statement",
    label_fr: "Relevé de carte de crédit",
    doc_type: "credit_card_statement",
    required: true,
  },
  {
    label: "Receipts (over $50)",
    label_fr: "Reçus (plus de 50 $)",
    doc_type: "receipt",
    required: false,
  },
  {
    label: "Invoices Issued",
    label_fr: "Factures émises",
    doc_type: "invoice",
    required: false,
  },
];

// Engagement specs — each one references a client by index in CLIENTS,
// declares dates/status, and picks items. Item statuses are overridden
// per-spec so dashboards have realistic mix.

const ENGAGEMENT_SPECS = [
  // ── Drafts ────────────────────────────────────────────────────
  {
    clientIdx: 0,
    title: "T1 2025 — Personal Tax",
    type: "t1",
    status: "draft",
    dueOffsetDays: 90,
    items: T1_ITEMS.slice(0, 4),
  },
  {
    clientIdx: 6,
    title: "T2 2025 — Corporate Year-End",
    type: "t2",
    status: "draft",
    dueOffsetDays: 120,
    items: T2_ITEMS,
  },

  // ── Sent (recent, no activity yet) ────────────────────────────
  {
    clientIdx: 1,
    title: "T1 2025 — Personal Tax",
    type: "t1",
    status: "sent",
    dueOffsetDays: 45,
    sentOffsetDays: -2,
    items: T1_ITEMS.slice(0, 5),
  },
  {
    clientIdx: 4,
    title: "T1 2025 — Personal Tax (English)",
    type: "t1",
    status: "sent",
    dueOffsetDays: 45,
    sentOffsetDays: -1,
    items: T1_ITEMS.slice(0, 4),
  },
  {
    clientIdx: 5,
    title: "T1 2025 — Personal Tax",
    type: "t1",
    status: "sent",
    dueOffsetDays: 60,
    sentOffsetDays: -3,
    items: T1_ITEMS,
  },
  {
    clientIdx: 9,
    title: "Q1 Bookkeeping Catch-Up",
    type: "bookkeeping",
    status: "sent",
    dueOffsetDays: 30,
    sentOffsetDays: -2,
    items: BOOKKEEPING_ITEMS,
  },

  // ── In progress — OVERDUE ─────────────────────────────────────
  {
    clientIdx: 2,
    title: "T1 2024 — Late File",
    type: "t1",
    status: "in_progress",
    dueOffsetDays: -5,
    sentOffsetDays: -20,
    items: [
      { ...T1_ITEMS[0], status: "approved" },
      { ...T1_ITEMS[1], status: "approved" },
      { ...T1_ITEMS[2], status: "pending" },
      { ...T1_ITEMS[3], status: "pending" },
      { ...T1_ITEMS[4], status: "pending" },
    ],
  },

  // ── In progress — DUE SOON, <80% done ─────────────────────────
  {
    clientIdx: 3,
    title: "T1 2025 — Personal Tax",
    type: "t1",
    status: "in_progress",
    dueOffsetDays: 4,
    sentOffsetDays: -10,
    items: [
      { ...T1_ITEMS[0], status: "approved" },
      { ...T1_ITEMS[1], status: "pending" },
      { ...T1_ITEMS[2], status: "pending" },
      { ...T1_ITEMS[3], status: "pending" },
    ],
  },

  // ── In progress — STALE (no client activity 5+ days) ──────────
  {
    clientIdx: 7,
    title: "Monthly Bookkeeping — March",
    type: "bookkeeping",
    status: "in_progress",
    dueOffsetDays: 20,
    sentOffsetDays: -12,
    items: [
      { ...BOOKKEEPING_ITEMS[0], status: "approved" },
      { ...BOOKKEEPING_ITEMS[1], status: "pending" },
      { ...BOOKKEEPING_ITEMS[2], status: "pending" },
      { ...BOOKKEEPING_ITEMS[3], status: "pending" },
    ],
  },

  // ── In progress — HEALTHY ─────────────────────────────────────
  {
    clientIdx: 8,
    title: "T2 2024 — Corporate Year-End",
    type: "t2",
    status: "in_progress",
    dueOffsetDays: 30,
    sentOffsetDays: -3,
    items: [
      { ...T2_ITEMS[0], status: "approved" },
      { ...T2_ITEMS[1], status: "approved" },
      { ...T2_ITEMS[2], status: "submitted" },
      { ...T2_ITEMS[3], status: "pending" },
      { ...T2_ITEMS[4], status: "pending" },
      { ...T2_ITEMS[5], status: "pending" },
    ],
  },

  // ── Ready to review (all required submitted) ──────────────────
  {
    clientIdx: 0,
    title: "T1 2024 — Personal Tax",
    type: "t1",
    status: "in_progress",
    dueOffsetDays: 15,
    sentOffsetDays: -7,
    items: [
      { ...T1_ITEMS[0], status: "submitted" },
      { ...T1_ITEMS[1], status: "submitted" },
      { ...T1_ITEMS[2], status: "submitted" },
      { ...T1_ITEMS[3], status: "submitted" },
    ],
  },
  {
    clientIdx: 6,
    title: "GST Return — Q4 2024",
    type: "custom",
    status: "in_progress",
    dueOffsetDays: 10,
    sentOffsetDays: -5,
    items: [
      {
        label: "Q4 GST/HST Working File",
        label_fr: "Fichier de travail TPS/TVH T4",
        doc_type: "gst_hst_qst",
        required: true,
        status: "submitted",
      },
      {
        label: "Bank Statement Q4",
        label_fr: "Relevé bancaire T4",
        doc_type: "bank_statement",
        required: true,
        status: "submitted",
      },
    ],
  },

  // ── Complete ──────────────────────────────────────────────────
  {
    clientIdx: 4,
    title: "T1 2024 — Personal Tax",
    type: "t1",
    status: "complete",
    dueOffsetDays: -30,
    sentOffsetDays: -60,
    completedOffsetDays: -5,
    items: [
      { ...T1_ITEMS[0], status: "approved" },
      { ...T1_ITEMS[1], status: "approved" },
      { ...T1_ITEMS[2], status: "approved" },
      { ...T1_ITEMS[3], status: "approved" },
    ],
  },
  {
    clientIdx: 9,
    title: "Year-End Bookkeeping 2024",
    type: "bookkeeping",
    status: "complete",
    dueOffsetDays: -45,
    sentOffsetDays: -90,
    completedOffsetDays: -10,
    items: [
      { ...BOOKKEEPING_ITEMS[0], status: "approved" },
      { ...BOOKKEEPING_ITEMS[1], status: "approved" },
      { ...BOOKKEEPING_ITEMS[2], status: "approved" },
      { ...BOOKKEEPING_ITEMS[3], status: "approved" },
    ],
  },

  // ── Cancelled ─────────────────────────────────────────────────
  {
    clientIdx: 5,
    title: "T1 2023 — Cancelled Engagement",
    type: "t1",
    status: "cancelled",
    dueOffsetDays: -180,
    sentOffsetDays: -200,
    items: [
      { ...T1_ITEMS[0], status: "pending" },
      { ...T1_ITEMS[1], status: "pending" },
    ],
  },
];
