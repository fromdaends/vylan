// Bulk-download every uploaded file for a single engagement as a ZIP.
//
// Auth model: the authed firm member is the actor. The route checks that the
// engagement belongs to their firm before doing any work — a stale `id` from
// another firm returns 404.
//
// IMPORTANT — why this returns a BUFFERED response, not a stream: returning a
// hand-constructed ReadableStream as the response body crashes Vercel's Node
// serverless runtime (instant 500, empty body — confirmed in prod via a
// diagnostic build, even on a 1 MB archive). It happily pipes a NATIVE fetch
// body stream (see /api/files/[id]) but throws on a JS-built ReadableStream. So
// we build the archive into bytes (incrementally — zipToBytes drains streamZip,
// which releases each file as it goes) and return a plain buffered Response,
// the standard reliable mechanism. Tax-doc archives are modest (a handful of
// files, low single-digit MB), so the in-memory buffer is fine.

import { NextResponse, type NextRequest } from "next/server";
import { format } from "date-fns";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { signedUrl } from "@/lib/storage";
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

  // On-disk filename: client - engagement - YYYY-MM-DD.zip. Each part sanitized
  // so paths / special chars can't escape the Content-Disposition.
  const clientPart = sanitizeFilenamePart(client?.display_name ?? "client");
  const titlePart = sanitizeFilenamePart(engagement.title);
  const datePart = format(new Date(), "yyyy-MM-dd");
  const archiveName = `${clientPart}-${titlePart}-${datePart}.zip`;

  await logUserActivity(firm.id, engagement.id, "bulk_download", {
    file_count: realFiles.length,
  });

  // Fetch each file's bytes. A document we can't sign or fetch is skipped, so
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

  try {
    const zipBytes = await zipToBytes(entries());
    return new Response(zipBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archiveName}"`,
        "Content-Length": String(zipBytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // Return a clean, descriptive error (never a bare/empty 500) so any future
    // failure is diagnosable from the response itself. No document contents.
    console.error("[files.zip] build failed", {
      engagement_id: engagement.id,
      file_count: realFiles.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "zip_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
