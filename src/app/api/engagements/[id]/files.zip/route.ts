// Bulk-download every uploaded file for a single engagement as a ZIP.
//
// Auth model: the authed firm member is the actor. The route checks that the
// engagement belongs to their firm before doing any work — a stale `id` from
// another firm returns 404.
//
// DELIVERY — why this returns a JSON {url} and downloads from STORAGE, not the
// zip bytes directly: Vercel's Node runtime crashes (instant empty 500) when
// this route returns the archive as its response body — BOTH a streamed
// ReadableStream AND a buffered Uint8Array (confirmed in prod, even on a ~1 MB
// archive; the build itself is fine). A small JSON response works, and the
// app's own upload flow already goes direct-to-storage to dodge these platform
// limits. So we build the zip (zipToBytes), upload it to storage, and hand the
// browser a short-lived signed URL with a download disposition. The download
// then streams straight from Supabase — no function-response body, no size cap.

import { NextResponse, type NextRequest } from "next/server";
import { format } from "date-fns";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { signedUrl, uploadObject } from "@/lib/storage";
import {
  zipToBytes,
  sanitizeFilenamePart,
  macZipEntryName,
  type ZipEntry,
} from "@/lib/zip";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 403 });
  }

  // Firm-scope the engagement lookup. A user from another firm gets an
  // indistinguishable 404 — no existence oracle.
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, title, firm_id, client_id")
    .eq("id", id)
    .eq("firm_id", firm.id)
    .maybeSingle();
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [{ data: client }, { data: files }] = await Promise.all([
    sb
      .from("clients")
      .select("display_name")
      .eq("id", engagement.client_id)
      .maybeSingle(),
    sb
      .from("uploaded_files")
      .select("id, storage_path, original_filename, display_name, is_duplicate")
      .eq("engagement_id", engagement.id)
      .order("uploaded_at", { ascending: true }),
  ]);

  // Exclude byte-identical re-uploads (the original they copy is already in the
  // archive) and any row without a storage path.
  const realFiles = (files ?? []).filter(
    (f) => !f.is_duplicate && f.storage_path,
  );
  if (realFiles.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 404 });
  }

  // Download filename: client - engagement - YYYY-MM-DD.zip. Sanitized so
  // special chars can't break the Content-Disposition on the signed URL.
  const clientPart = sanitizeFilenamePart(client?.display_name ?? "client");
  const titlePart = sanitizeFilenamePart(engagement.title);
  const datePart = format(new Date(), "yyyy-MM-dd");
  const archiveName = `${clientPart}-${titlePart}-${datePart}.zip`;

  await logUserActivity(firm.id, engagement.id, "bulk_download", {
    file_count: realFiles.length,
  });

  // Fetch each file's bytes. A document we can't sign or fetch is skipped so
  // one stale / erased object never sinks the whole download.
  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const f of realFiles) {
      const url = await signedUrl(f.storage_path, 300).catch(() => null);
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = new Uint8Array(await res.arrayBuffer());
        yield {
          name: macZipEntryName(f.display_name ?? f.original_filename),
          data,
        };
      } catch {
        continue;
      }
    }
  }

  // Build → store → sign. One export object per engagement (upsert overwrites
  // any prior one). The signed URL carries the download disposition so the
  // browser saves it as archiveName.
  let phase = "build";
  try {
    const zipBytes = await zipToBytes(entries());
    phase = "upload";
    const exportPath = `firms/${firm.id}/_exports/${engagement.id}.zip`;
    // The client-uploads bucket only allows document MIME types
    // (pdf/jpeg/png/webp/heic) — it REJECTS "application/zip". We declare an
    // allowed type here; it's cosmetic because the signed URL below carries a
    // Content-Disposition that forces the browser to save it as the real
    // <archiveName>.zip (verified: the file opens as a valid zip in macOS
    // Archive Utility / unzip). Avoids a bucket-config migration.
    await uploadObject({
      path: exportPath,
      body: zipBytes,
      contentType: "application/pdf",
      upsert: true,
    });
    phase = "sign";
    const url = await signedUrl(exportPath, 300, archiveName);
    return NextResponse.json({ url });
  } catch (e) {
    // Descriptive error (never a bare empty 500) so any future failure names
    // its phase. No document contents.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[files.zip] export failed", {
      engagement_id: engagement.id,
      phase,
      file_count: realFiles.length,
      error: message,
    });
    return NextResponse.json({ error: "export_failed", phase, message }, { status: 500 });
  }
}
