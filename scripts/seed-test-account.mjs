#!/usr/bin/env node
/* eslint-disable */
//
// Seed a complete test account on whichever Supabase the env points to.
// Creates the auth user, firm, owner row, fake clients, engagements with
// varied statuses (fresh / in-progress / AI-rejected / complete / draft),
// and uploaded_files rows so the dashboard looks realistic.
//
// Usage:
//   node --env-file=.env.local scripts/seed-test-account.mjs <email>
//   node --env-file=.env.local scripts/seed-test-account.mjs <email> --cleanup
//
// All firm + client + engagement names are prefixed "TEST —" so you can
// spot and bulk-delete them later.
//
// Re-running with the same email aborts unless you --cleanup first.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

// CRC table must be initialised before any top-level await; otherwise
// crc32() hits a TDZ error when solidPng() runs during seeding (top-level
// await pauses module evaluation before reaching `const` lines below).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

const FIRM_NAME = "TEST — Zachary's Test Firm";
const FIRM_BRAND_COLOR = "#1e293b";
const FIRM_TIMEZONE = "America/Toronto";
const FIRM_LOCALE = "en";
const STORAGE_BUCKET = "client-uploads";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.",
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = process.argv[2];
const cleanup = process.argv.includes("--cleanup");
const cleanupData = process.argv.includes("--cleanup-data");
if (!email || email.startsWith("--")) {
  console.error("Usage:");
  console.error("  node --env-file=.env.local scripts/seed-test-account.mjs <email>");
  console.error("  node --env-file=.env.local scripts/seed-test-account.mjs <email> --cleanup-data");
  console.error("  node --env-file=.env.local scripts/seed-test-account.mjs <email> --cleanup");
  process.exit(1);
}

if (cleanup) {
  await runCleanup(email);
  process.exit(0);
}
if (cleanupData) {
  await runCleanupData(email);
  process.exit(0);
}
await runSeed(email);

// ───────────────────────────────────────────────────────────────────────
// Main seed
// ───────────────────────────────────────────────────────────────────────

async function runSeed(email) {
  console.log(`Seeding test account for ${email} against ${SUPABASE_URL}\n`);

  // If the auth user already exists (e.g. the founder signed up earlier
  // for testing), seed onto their existing firm instead of creating a
  // new account. Keeps their current password intact.
  let firm;
  let password = null;
  const existing = await findAuthUser(email);
  if (existing) {
    const { data: userRow } = await sb
      .from("users")
      .select("firm_id, firms!inner(*)")
      .eq("id", existing.id)
      .maybeSingle();
    if (!userRow?.firm_id) {
      console.error(
        `Auth user ${email} exists but has no app-level user row. ` +
          `That's a partial signup; finish onboarding in the UI first, then re-run.`,
      );
      process.exit(1);
    }
    firm = userRow.firms;
    firm.id = userRow.firm_id;
    console.log(`✓ Existing auth user found (id=${existing.id})`);
    console.log(`✓ Adding test data to existing firm "${firm.name}" (id=${firm.id})\n`);
  } else {
    // Fresh path: create the auth user + firm + owner row.
    password = generatePassword();
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: "Zachary Thresh", locale: FIRM_LOCALE },
    });
    if (createErr) throw createErr;
    const authUserId = created.user.id;
    console.log(`✓ Auth user created (id=${authUserId}, email confirmed)`);

    const { data: newFirm, error: firmErr } = await sb
      .from("firms")
      .insert({
        name: FIRM_NAME,
        locale_default: FIRM_LOCALE,
        brand_color: FIRM_BRAND_COLOR,
        timezone: FIRM_TIMEZONE,
        plan: "trial",
        onboarded_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (firmErr) throw firmErr;
    firm = newFirm;
    console.log(`✓ Firm created (id=${firm.id})`);

    const { error: userErr } = await sb.from("users").insert({
      id: authUserId,
      firm_id: firm.id,
      email,
      name: "Zachary Thresh",
      role: "owner",
      locale: FIRM_LOCALE,
    });
    if (userErr) throw userErr;
    console.log(`✓ Owner user row linked to firm\n`);
  }

  // 5. Upload one tiny dummy PNG to storage. Every fake upload row
  //    points at this path so previews don't 404 in the dashboard.
  const dummyPath = `firm/${firm.id}/_test_dummy.png`;
  const dummyPng = solidPng(64, 64, [220, 220, 220]);
  const { error: storageErr } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(dummyPath, dummyPng, {
      contentType: "image/png",
      upsert: true,
    });
  if (storageErr) {
    console.warn(
      `(skip) storage upload failed (${storageErr.message}) — file previews will 404 but everything else works.`,
    );
  } else {
    console.log(`✓ Dummy preview file uploaded to ${STORAGE_BUCKET}/${dummyPath}\n`);
  }

  // 6. Insert 8 fake clients.
  const clientSpecs = [
    { name: "TEST — Jean Tremblay", type: "individual", locale: "fr", email: "jean.tremblay@example.test" },
    { name: "TEST — Marie Lefebvre", type: "individual", locale: "fr", email: "marie.lefebvre@example.test" },
    { name: "TEST — Acme Corp", type: "business", locale: "en", email: "ap@acme.example.test" },
    { name: "TEST — BellaVista Restaurant Inc.", type: "business", locale: "fr", email: "compta@bellavista.example.test" },
    { name: "TEST — David Chen", type: "individual", locale: "en", email: "david.chen@example.test" },
    { name: "TEST — Tech Innovations Ltd.", type: "business", locale: "en", email: "finance@techinnov.example.test" },
    { name: "TEST — Sophie Martin", type: "individual", locale: "fr", email: "sophie.martin@example.test" },
    { name: "TEST — Northern Lights Consulting", type: "business", locale: "en", email: "billing@northernlights.example.test" },
  ];
  const { data: clients, error: clientsErr } = await sb
    .from("clients")
    .insert(
      clientSpecs.map((c) => ({
        firm_id: firm.id,
        type: c.type,
        display_name: c.name,
        email: c.email,
        locale: c.locale,
      })),
    )
    .select("*");
  if (clientsErr) throw clientsErr;
  console.log(`✓ Created ${clients.length} clients`);

  // 7. Build 10 engagements covering the states you'd want to test.
  // Each entry: { client_idx, title, type, status, items: [{label, doc_type, required, result}] }
  // result is one of: "pending" (no upload), "submitted" (upload only),
  // "approved" (upload + approved), "rejected" (upload + manually rejected by accountant),
  // "ai_rejected" (upload + AI flagged + ai_rejected=true + reopened pending)
  const engagementSpecs = [
    // Eng 1 — brand-new T1, just sent, nothing uploaded yet
    { client_idx: 0, title: "TEST — Personal Tax 2025", type: "t1", status: "sent",
      items: [
        { label: "T4 Slip", label_fr: "Feuillet T4", doc_type: "t4", required: true, result: "pending" },
        { label: "RL-1 Slip", label_fr: "Feuillet RL-1", doc_type: "rl1", required: true, result: "pending" },
        { label: "Notice of Assessment 2024", label_fr: "Avis de cotisation 2024", doc_type: "noa", required: false, result: "pending" },
        { label: "Medical Receipts", label_fr: "Reçus médicaux", doc_type: "medical", required: false, result: "pending" },
        { label: "Donation Receipts", label_fr: "Reçus de dons", doc_type: "donation", required: false, result: "pending" },
      ] },
    // Eng 2 — fresh corporate, sent only
    { client_idx: 2, title: "TEST — Year-End 2025 (Corporate)", type: "t2", status: "sent",
      items: [
        { label: "Trial Balance", label_fr: "Balance de vérification", doc_type: "trial_balance", required: true, result: "pending" },
        { label: "General Ledger Export", label_fr: "Grand livre", doc_type: "gl_export", required: true, result: "pending" },
        { label: "Bank Statements (12 months)", label_fr: "Relevés bancaires (12 mois)", doc_type: "bank_statement", required: true, result: "pending" },
        { label: "Shareholder Loan Detail", label_fr: "Détail prêt actionnaire", doc_type: "shareholder_loan", required: false, result: "pending" },
      ] },
    // Eng 3 — halfway through T1
    { client_idx: 1, title: "TEST — Personal Tax 2025", type: "t1", status: "in_progress",
      items: [
        { label: "T4 Slip", label_fr: "Feuillet T4", doc_type: "t4", required: true, result: "submitted" },
        { label: "RL-1 Slip", label_fr: "Feuillet RL-1", doc_type: "rl1", required: true, result: "submitted" },
        { label: "T5 Slip", label_fr: "Feuillet T5", doc_type: "t5", required: true, result: "submitted" },
        { label: "Medical Receipts", label_fr: "Reçus médicaux", doc_type: "medical", required: false, result: "pending" },
        { label: "Childcare Receipts", label_fr: "Reçus de garde d'enfants", doc_type: "receipt", required: false, result: "pending" },
      ] },
    // Eng 4 — mid-review, accountant has approved some
    { client_idx: 4, title: "TEST — Personal Tax 2025", type: "t1", status: "in_progress",
      items: [
        { label: "T4 Slip", label_fr: "Feuillet T4", doc_type: "t4", required: true, result: "approved" },
        { label: "RRSP Contribution Slip", label_fr: "Reçu REER", doc_type: "rrsp", required: true, result: "approved" },
        { label: "T5 Slip", label_fr: "Feuillet T5", doc_type: "t5", required: true, result: "submitted" },
        { label: "Medical Receipts", label_fr: "Reçus médicaux", doc_type: "medical", required: false, result: "pending" },
        { label: "Donation Receipts", label_fr: "Reçus de dons", doc_type: "donation", required: false, result: "pending" },
      ] },
    // Eng 5 — accountant manually rejected one upload (wrong doc)
    { client_idx: 6, title: "TEST — Personal Tax 2025", type: "t1", status: "in_progress",
      items: [
        { label: "T4 Slip", label_fr: "Feuillet T4", doc_type: "t4", required: true, result: "submitted" },
        { label: "RL-1 Slip", label_fr: "Feuillet RL-1", doc_type: "rl1", required: true, result: "rejected", rejection_reason: "Wrong year — this is your 2023 RL-1. Please upload your 2024 slip." },
        { label: "Notice of Assessment 2024", label_fr: "Avis de cotisation 2024", doc_type: "noa", required: false, result: "pending" },
        { label: "T2202 (Tuition)", label_fr: "T2202 (frais de scolarité)", doc_type: "t2202", required: false, result: "pending" },
      ] },
    // Eng 6 — AI flagged a file as unusable (auto-reject)
    { client_idx: 3, title: "TEST — Year-End 2025 (Corporate)", type: "t2", status: "in_progress",
      items: [
        { label: "Trial Balance", label_fr: "Balance de vérification", doc_type: "trial_balance", required: true, result: "submitted" },
        { label: "Bank Statement (December)", label_fr: "Relevé bancaire (décembre)", doc_type: "bank_statement", required: true, result: "ai_rejected" },
        { label: "GST/HST Filing", label_fr: "Déclaration TPS/TVH", doc_type: "gst_hst_qst", required: true, result: "submitted" },
        { label: "Payroll Summary", label_fr: "Sommaire de la paie", doc_type: "payroll_summary", required: false, result: "pending" },
      ] },
    // Eng 7 — noisy in-progress with multiple uploads
    { client_idx: 5, title: "TEST — Year-End 2025 (Corporate)", type: "t2", status: "in_progress",
      items: [
        { label: "Trial Balance", label_fr: "Balance de vérification", doc_type: "trial_balance", required: true, result: "submitted" },
        { label: "General Ledger Export", label_fr: "Grand livre", doc_type: "gl_export", required: true, result: "submitted" },
        { label: "Capital Asset Additions", label_fr: "Ajouts immobilisations", doc_type: "capital_asset", required: false, result: "submitted" },
        { label: "Inventory Count Sheets", label_fr: "Inventaire", doc_type: "inventory", required: false, result: "submitted" },
        { label: "Year-End Invoices", label_fr: "Factures fin d'année", doc_type: "invoice", required: false, result: "submitted", extraFiles: 2 },
      ] },
    // Eng 8 — fully complete
    { client_idx: 0, title: "TEST — Personal Tax 2024 (DONE)", type: "t1", status: "complete",
      items: [
        { label: "T4 Slip", label_fr: "Feuillet T4", doc_type: "t4", required: true, result: "approved" },
        { label: "RL-1 Slip", label_fr: "Feuillet RL-1", doc_type: "rl1", required: true, result: "approved" },
        { label: "T5 Slip", label_fr: "Feuillet T5", doc_type: "t5", required: true, result: "approved" },
        { label: "Medical Receipts", label_fr: "Reçus médicaux", doc_type: "medical", required: false, result: "approved" },
      ] },
    // Eng 9 — bookkeeping monthly
    { client_idx: 7, title: "TEST — Bookkeeping — April 2026", type: "bookkeeping", status: "in_progress",
      items: [
        { label: "Bank Statement (April)", label_fr: "Relevé bancaire (avril)", doc_type: "bank_statement", required: true, result: "submitted" },
        { label: "Credit Card Statement (April)", label_fr: "Relevé carte de crédit (avril)", doc_type: "credit_card_statement", required: true, result: "submitted" },
        { label: "Expense Receipts", label_fr: "Reçus de dépenses", doc_type: "receipt", required: false, result: "pending" },
      ] },
    // Eng 10 — draft (not even sent yet)
    { client_idx: 7, title: "TEST — Custom Project (drafting)", type: "custom", status: "draft",
      items: [
        { label: "Project Brief", label_fr: "Devis de projet", doc_type: "other", required: true, result: "pending" },
        { label: "Sample Output", label_fr: "Exemple de livrable", doc_type: "other", required: false, result: "pending" },
      ] },
  ];

  let totalItems = 0;
  let totalUploads = 0;
  let aiRejectedCount = 0;

  for (const spec of engagementSpecs) {
    const client = clients[spec.client_idx];
    const magicToken = generateMagicToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const sentAt = spec.status === "draft" ? null : new Date().toISOString();
    const completedAt = spec.status === "complete" ? new Date().toISOString() : null;

    const { data: engagement, error: engErr } = await sb
      .from("engagements")
      .insert({
        firm_id: firm.id,
        client_id: client.id,
        title: spec.title,
        type: spec.type,
        status: spec.status,
        sent_at: sentAt,
        completed_at: completedAt,
        magic_token: spec.status === "draft" ? null : magicToken,
        magic_expires_at: spec.status === "draft" ? null : expiresAt.toISOString(),
      })
      .select("*")
      .single();
    if (engErr) throw engErr;

    // Insert request items.
    const itemRows = spec.items.map((it, idx) => ({
      engagement_id: engagement.id,
      label: it.label,
      label_fr: it.label_fr,
      doc_type: it.doc_type,
      required: it.required,
      order_index: idx,
      status: itemStatusFor(it.result),
      rejection_reason: it.rejection_reason ?? null,
    }));
    const { data: items, error: itemsErr } = await sb
      .from("request_items")
      .insert(itemRows)
      .select("*");
    if (itemsErr) throw itemsErr;
    totalItems += items.length;

    // Insert uploaded_files rows for items that have a "result" implying an upload.
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const spec_i = spec.items[i];
      if (
        spec_i.result === "pending" ||
        (spec_i.result === "rejected" && false /* manual rejects still keep the file */)
      ) {
        // pending = no upload. rejected manual = keep the file (don't skip).
        if (spec_i.result === "pending") continue;
      }

      const extra = spec_i.extraFiles ?? 0;
      const totalForItem = 1 + extra;
      for (let copy = 0; copy < totalForItem; copy++) {
        const filename = pickFakeFilename(spec_i.doc_type, copy);
        const fileRow = {
          request_item_id: it.id,
          engagement_id: engagement.id,
          storage_path: dummyPath, // all rows point at the one dummy file
          original_filename: filename,
          mime_type: filename.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
          size_bytes: 142_360 + Math.floor(Math.random() * 800_000),
        };

        // AI-rejected: mark this file as flagged + populate ai_usability.
        if (spec_i.result === "ai_rejected" && copy === 0) {
          fileRow.ai_classification = spec_i.doc_type;
          fileRow.ai_confidence = 0.94;
          fileRow.ai_rejected = true;
          fileRow.ai_usability = {
            usable: false,
            confidence: 0.93,
            primary_issue: "partial_capture",
            all_issues: ["partial_capture"],
            issue_summary_fr: "Le bas du relevé est coupé — le total et la date manquent.",
            issue_summary_en: "The bottom of the statement is cut off — totals and date are missing.",
          };
        }

        const { error: fileErr } = await sb.from("uploaded_files").insert(fileRow);
        if (fileErr) throw fileErr;
        totalUploads++;

        // Activity log for the upload event.
        await sb.from("activity_log").insert({
          firm_id: firm.id,
          engagement_id: engagement.id,
          actor_type: "client",
          action: "client_uploaded",
          metadata: { item_id: it.id, size_bytes: fileRow.size_bytes },
        });
      }
    }

    // For AI-rejected engagements, log the ai_auto_rejected event so the
    // activity timeline matches what the real router would have written.
    if (spec.items.some((s) => s.result === "ai_rejected")) {
      aiRejectedCount++;
      await sb.from("activity_log").insert({
        firm_id: firm.id,
        engagement_id: engagement.id,
        actor_type: "system",
        action: "ai_auto_rejected",
        metadata: {
          primary_issue: "partial_capture",
          usability_confidence: 0.93,
        },
      });
    }

    console.log(
      `  · ${spec.title.padEnd(46)} → ${spec.status.padEnd(12)} (${items.length} items)`,
    );
  }

  console.log(
    `\n✓ Created ${engagementSpecs.length} engagements, ${totalItems} items, ${totalUploads} uploads (${aiRejectedCount} with AI-rejected file)\n`,
  );

  // 8. Print credentials + next steps.
  console.log("======================================================================");
  console.log("LOGIN");
  console.log("======================================================================");
  console.log(`  Email:    ${email}`);
  if (password) {
    console.log(`  Password: ${password}`);
    console.log("");
    console.log("Change the password immediately in /profile after first login.");
  } else {
    console.log(`  Password: (unchanged — use whatever you set when you signed up)`);
    console.log("           Forgot it? Use 'Forgot password' on the login page.");
  }
  console.log("======================================================================");
  console.log("");
  console.log("To wipe ALL test data added by this script (keeps your account):");
  console.log(`  node --env-file=.env.local scripts/seed-test-account.mjs ${email} --cleanup-data`);
  console.log("");
  console.log("To nuke the entire account (auth user + firm):");
  console.log(`  node --env-file=.env.local scripts/seed-test-account.mjs ${email} --cleanup`);
}

// ───────────────────────────────────────────────────────────────────────
// Data-only cleanup — deletes TEST-prefixed clients (and their cascading
// engagements/items/uploads/activity) but leaves the auth user and firm
// intact. Use this when you want to wipe just what this script added.
// ───────────────────────────────────────────────────────────────────────

async function runCleanupData(email) {
  const existing = await findAuthUser(email);
  if (!existing) {
    console.log(`No auth user with email ${email}. Nothing to clean.`);
    return;
  }
  const { data: userRow } = await sb
    .from("users")
    .select("firm_id")
    .eq("id", existing.id)
    .maybeSingle();
  if (!userRow?.firm_id) {
    console.log(`No firm linked to ${email}. Nothing to clean.`);
    return;
  }
  const { data: testClients } = await sb
    .from("clients")
    .select("id")
    .eq("firm_id", userRow.firm_id)
    .like("display_name", "TEST —%");
  if (!testClients?.length) {
    console.log("No TEST-prefixed clients found. Nothing to clean.");
    return;
  }
  const ids = testClients.map((c) => c.id);
  await sb.from("clients").delete().in("id", ids);
  console.log(`✓ Deleted ${ids.length} TEST client(s) and all their engagements/items/uploads.`);
  // Also drop the dummy storage object if it's still there.
  const dummyPath = `firm/${userRow.firm_id}/_test_dummy.png`;
  await sb.storage.from(STORAGE_BUCKET).remove([dummyPath]);
}

// ───────────────────────────────────────────────────────────────────────
// Cleanup — nukes auth user + cascades through firms/clients/etc.
// ───────────────────────────────────────────────────────────────────────

async function runCleanup(email) {
  const existing = await findAuthUser(email);
  if (!existing) {
    console.log(`No auth user with email ${email} found. Nothing to clean.`);
    return;
  }
  // Find the firm via the app-level user row.
  const { data: userRow } = await sb
    .from("users")
    .select("firm_id")
    .eq("id", existing.id)
    .maybeSingle();

  if (userRow?.firm_id) {
    // Best-effort storage cleanup (the dummy file + anything else under firm/).
    const prefix = `firm/${userRow.firm_id}`;
    const { data: listed } = await sb.storage
      .from(STORAGE_BUCKET)
      .list(prefix, { limit: 1000 });
    if (listed?.length) {
      const paths = listed.map((f) => `${prefix}/${f.name}`);
      await sb.storage.from(STORAGE_BUCKET).remove(paths);
      console.log(`✓ Deleted ${paths.length} storage object(s) under ${prefix}/`);
    }
    // Delete the firm — cascades to users, clients, engagements,
    // request_items, uploaded_files, activity_log, etc.
    await sb.from("firms").delete().eq("id", userRow.firm_id);
    console.log(`✓ Deleted firm ${userRow.firm_id} and all firm-scoped rows`);
  }

  // Finally, drop the auth user.
  const { error: delAuthErr } = await sb.auth.admin.deleteUser(existing.id);
  if (delAuthErr) throw delAuthErr;
  console.log(`✓ Deleted auth user ${existing.id} (${email})`);
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

async function findAuthUser(email) {
  // listUsers is paginated; for small projects one page is fine.
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

function generatePassword() {
  // 18 chars, mix of alphanum + a few symbols. Easy to copy/paste,
  // strong enough that nobody's guessing it.
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;
  // Guarantee one from each class so it always passes typical policies.
  const out = [
    pickRandom(upper),
    pickRandom(lower),
    pickRandom(digits),
    pickRandom(symbols),
  ];
  const bytes = randomBytes(14);
  for (let i = 0; i < 14; i++) out.push(all[bytes[i] % all.length]);
  // Shuffle.
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

function pickRandom(s) {
  return s[randomBytes(1)[0] % s.length];
}

function generateMagicToken() {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  const bytes = randomBytes(43);
  for (let i = 0; i < 43; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function itemStatusFor(result) {
  switch (result) {
    case "pending":
      return "pending";
    case "submitted":
      return "submitted";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "ai_rejected":
      // AI-auto-reject reopens the item to "pending" + sets rejection_reason.
      return "pending";
    default:
      return "pending";
  }
}

function pickFakeFilename(doc_type, copy) {
  const stems = {
    t4: "T4_2025",
    rl1: "RL-1_2025",
    t5: "T5_2025",
    rl3: "RL-3_2025",
    t3: "T3_2025",
    rl16: "RL-16_2025",
    noa: "Notice_of_Assessment_2024",
    bank_statement: "Bank_Statement",
    credit_card_statement: "Credit_Card_Statement",
    receipt: "Receipts",
    t2202: "T2202_Tuition_2025",
    rrsp: "RRSP_Contribution_2025",
    medical: "Medical_Receipts_2025",
    donation: "Donation_Receipts_2025",
    rental: "Rental_Income_2025",
    gst_hst_qst: "GST_HST_Filing_Q4",
    trial_balance: "Trial_Balance_2025",
    gl_export: "General_Ledger_2025",
    financials: "Financial_Statements_2025",
    shareholder_loan: "Shareholder_Loan_Detail",
    payroll_summary: "Payroll_Summary_2025",
    capital_asset: "Capital_Assets_2025",
    inventory: "Inventory_Count_2025",
    invoice: "Invoice",
    other: "Document",
  };
  const stem = stems[doc_type] ?? "Document";
  const suffix = copy > 0 ? `_${copy + 1}` : "";
  const ext = ["bank_statement", "credit_card_statement", "trial_balance", "gl_export", "noa", "t4", "rl1"].includes(doc_type)
    ? ".pdf"
    : ".jpg";
  return `${stem}${suffix}${ext}`;
}

// Solid-color 64×64 PNG, hand-rolled (no deps). Lifted from
// scripts/seed-ai-test.mjs.
function solidPng(width, height, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk(
    "IHDR",
    Buffer.concat([
      u32(width),
      u32(height),
      Buffer.from([8, 2, 0, 0, 0]),
    ]),
  );
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(width * 3).fill(0).map((_, i) => [r, g, b][i % 3]),
  ]);
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
  const idat = chunk("IDAT", zlibStore(raw));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function chunk(type, data) {
  const len = u32(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = u32(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function zlibStore(data) {
  const out = [];
  out.push(Buffer.from([0x78, 0x01]));
  let i = 0;
  while (i < data.length) {
    const remain = data.length - i;
    const blen = Math.min(remain, 65535);
    const isLast = blen === remain;
    out.push(Buffer.from([isLast ? 0x01 : 0x00, blen & 0xff, (blen >>> 8) & 0xff, ~blen & 0xff, (~blen >>> 8) & 0xff]));
    out.push(data.slice(i, i + blen));
    i += blen;
  }
  out.push(u32(adler32(data)));
  return Buffer.concat(out);
}

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
