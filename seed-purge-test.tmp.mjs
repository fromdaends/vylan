// Seeds two throwaway soft-deleted engagements on the TEST client so the new
// "Delete forever" flow can be verified end-to-end without touching real data.
// A: no documents  -> expect instant purge, no dialog.
// B: one unfiled final_documents row (with a real tiny storage object)
//    -> expect the warning dialog, then purge on confirm.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: client, error: cErr } = await sb
  .from("clients")
  .select("id, firm_id, display_name")
  .ilike("display_name", "%TEST%Acme%")
  .limit(1)
  .maybeSingle();
if (cErr || !client) throw new Error("client lookup: " + (cErr?.message ?? "not found"));

// Re-runnable: sweep any leftovers from a previous run first.
await sb
  .from("engagements")
  .delete()
  .eq("firm_id", client.firm_id)
  .ilike("title", "CLAUDE TEST purge%");

const now = new Date().toISOString();
const mk = (title) => ({
  firm_id: client.firm_id,
  client_id: client.id,
  title,
  type: "custom",
  status: "draft",
  deleted_at: now,
});

const { data: engs, error: eErr } = await sb
  .from("engagements")
  .insert([mk("CLAUDE TEST purge A (empty)"), mk("CLAUDE TEST purge B (unfiled doc)")])
  .select("id, title");
if (eErr) throw new Error("engagement insert: " + eErr.message);
const A = engs.find((e) => e.title.includes("A"));
const B = engs.find((e) => e.title.includes("B"));

// A real (tiny) object in the bucket so the purge's storage removal is exercised.
const path = `${client.firm_id}/claude-test/purge-verify-${Date.now()}.pdf`;
const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
const up = await sb.storage
  .from("client-uploads")
  .upload(path, new Blob([pdf], { type: "application/pdf" }), {
    contentType: "application/pdf",
  });
if (up.error) throw new Error("storage upload: " + up.error.message);

const { error: fErr } = await sb.from("final_documents").insert({
  firm_id: client.firm_id,
  engagement_id: B.id,
  storage_path: path,
  original_filename: "claude-purge-test.pdf",
  display_name: "CLAUDE purge test doc",
  mime_type: "application/pdf",
  size_bytes: pdf.length,
  uploaded_by_user_id: null,
});
if (fErr) throw new Error("final_documents insert: " + fErr.message);

console.log(JSON.stringify({ ok: true, A: A.id, B: B.id, storagePath: path }));
