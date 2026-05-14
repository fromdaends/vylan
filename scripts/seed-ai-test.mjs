#!/usr/bin/env node
/* eslint-disable */
//
// Seeds a fake client + engagement on production and uploads two
// deliberately bad images so you can verify the AI auto-reject flow
// end-to-end. The fake client gets your own email so the magic link
// comes to YOU, not a real client.
//
// Usage (from the project root, on your Mac):
//
//   1. Pull production env vars into a local file:
//        npx vercel env pull .env.test
//
//   2. Run the script:
//        node --env-file=.env.test scripts/seed-ai-test.mjs your@email.com
//
//   3. (Optional) After verifying, clean up the test rows:
//        node --env-file=.env.test scripts/seed-ai-test.mjs --cleanup
//
// What it does:
//   - Looks up your firm by your accountant email.
//   - Inserts a client called "AI Test Client (delete me)".
//   - Inserts an engagement with two request items (T4, bank statement).
//   - Generates two deliberately-bad PNGs (solid black, solid white).
//   - Uploads both via /api/portal/upload using the engagement's magic
//     token. The upload endpoint runs the AI classifier inline, so
//     within ~10s the AI verdict + auto-reject decision is in the DB.
//   - Polls the uploaded_files row a few times and prints the verdict.
//
// Schema assumptions match supabase/migrations/0001_init.sql + 0029_ai_usability.sql.

import { createClient } from "@supabase/supabase-js";

const TEST_CLIENT_LABEL = "AI Test Client (delete me)";
const POLL_INTERVAL_MS = 1500;
const POLL_ATTEMPTS = 20;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Did you run `npx vercel env pull .env.test` first?",
  );
  process.exit(1);
}
if (!APP_URL) {
  console.error("Missing APP_URL in env (needed to call /api/portal/upload).");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const arg = process.argv[2];
if (arg === "--cleanup") {
  await cleanup();
  process.exit(0);
}
if (!arg || arg.startsWith("--")) {
  console.error(
    "Usage: node --env-file=.env.test scripts/seed-ai-test.mjs your@email.com",
  );
  console.error("       node --env-file=.env.test scripts/seed-ai-test.mjs --cleanup");
  process.exit(1);
}
await run(arg);

async function run(accountantEmail) {
  // 1. Find the user + firm.
  const { data: userRow, error: userErr } = await sb
    .from("users")
    .select("id, firm_id, name, email")
    .eq("email", accountantEmail)
    .maybeSingle();
  if (userErr) throw userErr;
  if (!userRow?.firm_id) {
    console.error(`No user with email ${accountantEmail} found.`);
    process.exit(1);
  }
  console.log(`✓ Found firm ${userRow.firm_id} for ${accountantEmail}`);

  // 2. Insert test client.
  const { data: client, error: clientErr } = await sb
    .from("clients")
    .insert({
      firm_id: userRow.firm_id,
      type: "individual",
      display_name: TEST_CLIENT_LABEL,
      email: accountantEmail,
      locale: "en",
    })
    .select("*")
    .single();
  if (clientErr) throw clientErr;
  console.log(`✓ Created client ${client.id} (${TEST_CLIENT_LABEL})`);

  // 3. Insert engagement (status=sent so /api/portal/upload accepts uploads).
  const magicToken = generateMagicToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  const { data: engagement, error: engErr } = await sb
    .from("engagements")
    .insert({
      firm_id: userRow.firm_id,
      client_id: client.id,
      title: "AI Test — Tax Year 2025 (delete me)",
      type: "t1",
      status: "sent",
      sent_at: new Date().toISOString(),
      magic_token: magicToken,
      magic_expires_at: expiresAt.toISOString(),
    })
    .select("*")
    .single();
  if (engErr) throw engErr;
  console.log(`✓ Created engagement ${engagement.id} (magic token issued)`);

  // 4. Insert request items.
  const itemSpecs = [
    {
      label: "T4 Slip",
      label_fr: "Feuillet T4",
      description: "Your T4 slip from your employer for 2025.",
      doc_type: "t4",
      required: true,
      order_index: 0,
    },
    {
      label: "Bank Statement",
      label_fr: "Relevé bancaire",
      description: "January 2025 bank statement (any chequing account).",
      doc_type: "bank_statement",
      required: false,
      order_index: 1,
    },
  ];
  const { data: items, error: itemsErr } = await sb
    .from("request_items")
    .insert(
      itemSpecs.map((i) => ({
        engagement_id: engagement.id,
        ...i,
        status: "pending",
      })),
    )
    .select("*");
  if (itemsErr) throw itemsErr;
  console.log(`✓ Created ${items.length} request items`);

  // 5. Generate two deliberately-bad PNGs and upload via /api/portal/upload.
  // Using solid-color images guarantees the AI classifier marks them as
  // unusable (no text / no document content visible).
  const blackPng = solidPng(64, 64, [0, 0, 0]);
  const whitePng = solidPng(64, 64, [255, 255, 255]);
  const targets = [
    { item: items[0], png: blackPng, name: "blank-black.png" },
    { item: items[1], png: whitePng, name: "blank-white.png" },
  ];

  const uploadedIds = [];
  for (const t of targets) {
    const fd = new FormData();
    fd.append("token", magicToken);
    fd.append("item_id", t.item.id);
    fd.append(
      "file",
      new Blob([t.png], { type: "image/png" }),
      t.name,
    );
    const res = await fetch(`${APP_URL}/api/portal/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(
        `✗ Upload for ${t.item.label} failed: ${res.status} ${text}`,
      );
      continue;
    }
    console.log(`✓ Uploaded ${t.name} for ${t.item.label}`);
    uploadedIds.push(t.item.id);
  }

  // 6. Poll uploaded_files for the AI verdict.
  console.log("\nWaiting for AI classification (runs inline, ~5–10s)…");
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const { data: files } = await sb
      .from("uploaded_files")
      .select("id, request_item_id, ai_classification, ai_usability, ai_rejected, original_filename")
      .in("request_item_id", uploadedIds);
    const allClassified = files?.every((f) => f.ai_usability != null);
    if (allClassified) {
      console.log("\n=== AI VERDICTS ===");
      for (const f of files) {
        console.log(`\nFile: ${f.original_filename}`);
        console.log(`  classification: ${f.ai_classification ?? "—"}`);
        console.log(`  usable: ${f.ai_usability?.usable}`);
        console.log(`  usability_confidence: ${f.ai_usability?.confidence}`);
        console.log(`  primary_issue: ${f.ai_usability?.primary_issue ?? "—"}`);
        console.log(`  auto_rejected: ${f.ai_rejected}`);
      }
      break;
    }
    process.stdout.write(".");
  }

  // 7. Print useful follow-up links.
  const portalUrl = `${APP_URL}/r/${magicToken}`;
  const dashboardUrl = `${APP_URL}/en/engagements/${engagement.id}`;
  console.log("\n\n=== NEXT STEPS ===");
  console.log(`Client portal:   ${portalUrl}`);
  console.log(`Your dashboard:  ${dashboardUrl}`);
  console.log(`\nVisit your dashboard to see the AI badges + activity log.`);
  console.log(`Cleanup:         node --env-file=.env.test scripts/seed-ai-test.mjs --cleanup`);
}

async function cleanup() {
  // Cascading delete: engagements + uploaded_files + request_items go
  // away automatically thanks to ON DELETE CASCADE on the FKs.
  const { data: clients, error: findErr } = await sb
    .from("clients")
    .select("id, firm_id")
    .eq("display_name", TEST_CLIENT_LABEL);
  if (findErr) throw findErr;
  if (!clients?.length) {
    console.log("Nothing to clean up — no test clients found.");
    return;
  }
  const ids = clients.map((c) => c.id);
  const { error: delErr } = await sb.from("clients").delete().in("id", ids);
  if (delErr) throw delErr;
  console.log(`✓ Deleted ${ids.length} test client(s) and all their engagements/items/uploads.`);
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (no external deps).
// ─────────────────────────────────────────────────────────────────────

// Mirror src/lib/db/engagements.ts: 43-char alphanumeric token.
function generateMagicToken() {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// Build a minimal valid PNG of the given size and solid RGB color.
// Hand-rolled to avoid pulling in sharp/canvas as script-time deps.
function solidPng(width, height, [r, g, b]) {
  // PNG = 8-byte signature + IHDR chunk + IDAT chunk + IEND chunk.
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk(
    "IHDR",
    Buffer.concat([
      u32(width),
      u32(height),
      Buffer.from([8, 2, 0, 0, 0]), // 8-bit, color type 2 (RGB), no compression/filter/interlace
    ]),
  );
  // Raw scanlines: filter byte 0 + RGB pixels.
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(width * 3).fill(0).map((_, i) => [r, g, b][i % 3]),
  ]);
  const raw = Buffer.alloc((row.length) * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
  // Zlib-compress at level 0 (no compression) so we don't need the
  // full deflate library — wrap raw in a non-compressed zlib stream.
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

// Wrap raw bytes in a zlib stream with stored (uncompressed) deflate
// blocks. Adler32 trailer for integrity.
function zlibStore(data) {
  const out = [];
  // zlib header: deflate, 32k window, no dict, fastest level.
  out.push(Buffer.from([0x78, 0x01]));
  // Stored deflate blocks: each block max 65535 bytes.
  let i = 0;
  while (i < data.length) {
    const remain = data.length - i;
    const blen = Math.min(remain, 65535);
    const isLast = blen === remain;
    out.push(Buffer.from([isLast ? 0x01 : 0x00, blen & 0xff, (blen >>> 8) & 0xff, ~blen & 0xff, (~blen >>> 8) & 0xff]));
    out.push(data.slice(i, i + blen));
    i += blen;
  }
  // Adler32 trailer.
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
