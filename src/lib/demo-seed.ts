// Demo data seeded into a brand-new firm when it's created from the
// public signup flow with `is_demo = true`. The dashboard / clients /
// engagements list have something realistic to interact with on first
// load so the visitor can actually see how Relai works instead of
// staring at empty states.
//
// Service-role insert: onboarding's submitStep1 already uses the
// service-role client to create the firms + users rows, so this
// function runs in the same context. RLS-bypass is intentional here
// (no auth.uid at this point — the user hasn't been issued an auth
// row yet).

import { type SupabaseClient } from "@supabase/supabase-js";

const DEMO_TAG = "Demo: ";

type SeedClient = {
  type: "individual" | "business";
  name: string;
  email: string;
  phone: string | null;
  locale: "fr" | "en";
  notes: string | null;
  external_ref: string | null;
};

const DEMO_CLIENTS: SeedClient[] = [
  {
    type: "individual",
    name: "Jean-François Bouchard",
    email: "jf.bouchard@example.com",
    phone: "+15145557101",
    locale: "fr",
    notes: "Locataire — deux T4 cette année.",
    external_ref: null,
  },
  {
    type: "individual",
    name: "Marie-Claude Pelletier",
    email: "mc.pelletier@example.com",
    phone: "+14185557102",
    locale: "fr",
    notes: null,
    external_ref: "MCP-2025",
  },
  {
    type: "individual",
    name: "Emma Wright",
    email: "emma.wright@example.com",
    phone: "+15145557105",
    locale: "en",
    notes: "Anglophone — expat from Toronto.",
    external_ref: null,
  },
  {
    type: "business",
    name: "Boulangerie du Quartier Inc.",
    email: "compta@boulangerie.example.com",
    phone: "+15145557201",
    locale: "fr",
    notes: "Fin d'année 31 décembre.",
    external_ref: "BQ-INC",
  },
  {
    type: "business",
    name: "Northern Lights Bakery Inc.",
    email: "accounts@northernlights.example.com",
    phone: "+15145557204",
    locale: "en",
    notes: null,
    external_ref: "NL-INC",
  },
];

type SeedItem = {
  label: string;
  label_fr: string;
  doc_type: string;
  required: boolean;
  status: "pending" | "submitted" | "approved";
};

type SeedEngagement = {
  title: string;
  type: string;
  status: "sent" | "in_progress" | "complete";
  client_idx: number;
  due_offset_days: number;
  sent_offset_days: number;
  completed_offset_days?: number;
  items: SeedItem[];
};

const DEMO_ENGAGEMENTS: SeedEngagement[] = [
  {
    // Hot one: in-progress, due soon, some items submitted, some still
    // pending. Drives the "Needs attention" / "Ready to review" sections.
    title: "T1 2025 — Bouchard",
    type: "t1",
    status: "in_progress",
    client_idx: 0,
    due_offset_days: 12,
    sent_offset_days: -8,
    items: [
      { label: "T4 Slip", label_fr: "Feuillet T4", doc_type: "t4", required: true, status: "submitted" },
      { label: "RL-1 Slip", label_fr: "Relevé 1", doc_type: "rl1", required: true, status: "submitted" },
      { label: "T5 Slip", label_fr: "Feuillet T5", doc_type: "t5", required: false, status: "pending" },
      { label: "RRSP Contribution Receipt", label_fr: "Reçu de cotisation REER", doc_type: "rrsp", required: false, status: "submitted" },
      { label: "Medical Expenses", label_fr: "Frais médicaux", doc_type: "medical", required: false, status: "pending" },
    ],
  },
  {
    // Fresh send — recent, nothing back yet.
    title: "T1 2025 — Pelletier",
    type: "t1",
    status: "sent",
    client_idx: 1,
    due_offset_days: 25,
    sent_offset_days: -1,
    items: [
      { label: "T4 Slip", label_fr: "Feuillet T4", doc_type: "t4", required: true, status: "pending" },
      { label: "RL-1 Slip", label_fr: "Relevé 1", doc_type: "rl1", required: true, status: "pending" },
      { label: "Charitable Donation Receipts", label_fr: "Reçus de dons", doc_type: "donation", required: false, status: "pending" },
    ],
  },
  {
    // Ready-to-review: every required item submitted.
    title: "Year-End 2024 — Boulangerie du Quartier",
    type: "t2",
    status: "in_progress",
    client_idx: 3,
    due_offset_days: 8,
    sent_offset_days: -14,
    items: [
      { label: "Trial Balance", label_fr: "Balance de vérification", doc_type: "trial_balance", required: true, status: "submitted" },
      { label: "General Ledger Export", label_fr: "Export du grand livre", doc_type: "gl_export", required: true, status: "submitted" },
      { label: "Bank Statements (12 months)", label_fr: "Relevés bancaires (12 mois)", doc_type: "bank_statement", required: true, status: "submitted" },
      { label: "GST/HST/QST Filings", label_fr: "Déclarations TPS/TVH/TVQ", doc_type: "gst_hst_qst", required: true, status: "submitted" },
    ],
  },
];

function offsetISO(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function offsetDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function generateMagicToken(): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// Seeds demo clients / engagements / items into a firm. Best-effort:
// every insertion runs independently so a single broken row doesn't
// take down the rest of the seed (and onboarding still proceeds).
export async function seedDemoData(
  admin: SupabaseClient,
  firmId: string,
): Promise<void> {
  // 1) Clients.
  const clientRows = DEMO_CLIENTS.map((c) => ({
    firm_id: firmId,
    type: c.type,
    display_name: `${DEMO_TAG}${c.name}`,
    email: c.email,
    phone: c.phone,
    locale: c.locale,
    external_ref: c.external_ref,
    notes: c.notes,
  }));
  const { data: clients, error: cErr } = await admin
    .from("clients")
    .insert(clientRows)
    .select("id");
  if (cErr || !clients) {
    console.error("[demo-seed] clients insert failed:", cErr);
    return;
  }

  // 2) Engagements.
  const engagementRows = DEMO_ENGAGEMENTS.map((spec) => {
    const clientId = clients[spec.client_idx]?.id;
    if (!clientId) return null;
    return {
      firm_id: firmId,
      client_id: clientId,
      title: spec.title,
      type: spec.type,
      status: spec.status,
      due_date: offsetDate(spec.due_offset_days),
      sent_at: offsetISO(spec.sent_offset_days),
      completed_at:
        spec.status === "complete"
          ? offsetISO(spec.completed_offset_days ?? -3)
          : null,
      magic_token: generateMagicToken(),
      magic_expires_at: offsetISO(90),
      // Demo engagements have realistic sent_at timestamps, so the
      // reminder cron would otherwise try to email the fake clients.
      // Pause reminders at seed-time so the cron skips them entirely
      // without us having to gate the cron with an is_demo check.
      reminders_paused: true,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const { data: engagements, error: eErr } = await admin
    .from("engagements")
    .insert(engagementRows)
    .select("id");
  if (eErr || !engagements) {
    console.error("[demo-seed] engagements insert failed:", eErr);
    return;
  }

  // 3) Request items per engagement.
  for (let i = 0; i < engagements.length; i++) {
    const eng = engagements[i];
    const spec = DEMO_ENGAGEMENTS[i];
    if (!eng || !spec) continue;
    const items = spec.items.map((it, idx) => ({
      engagement_id: eng.id,
      label: it.label,
      label_fr: it.label_fr,
      doc_type: it.doc_type,
      required: it.required,
      order_index: idx,
      status: it.status,
      approved_at:
        it.status === "approved" ? offsetISO(-2) : null,
    }));
    const { error: iErr } = await admin
      .from("request_items")
      .insert(items);
    if (iErr) {
      console.error(
        `[demo-seed] items insert failed for engagement ${eng.id}:`,
        iErr,
      );
    }
  }

  // 4) A couple of activity_log rows so the AI activity section on
  // the dashboard isn't completely empty. Best-effort.
  if (engagements[0]) {
    await admin.from("activity_log").insert([
      {
        firm_id: firmId,
        engagement_id: engagements[0].id,
        actor_type: "system",
        action: "ai_classified",
        metadata: { document_type: "t4", confidence: 0.94 },
        created_at: offsetISO(-2),
      },
      {
        firm_id: firmId,
        engagement_id: engagements[0].id,
        actor_type: "system",
        action: "ai_quality_flagged",
        metadata: { primary_issue: "glare_or_shadow", usability_confidence: 0.71 },
        created_at: offsetISO(-1),
      },
    ]);
  }
}
