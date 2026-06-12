// Bulk-download every uploaded file for a single engagement as a ZIP.
//
// Auth model: the authed firm member is the actor. The route checks
// that the engagement belongs to their firm before doing any work — a
// stale `id` from another firm returns 404.
//
// We fetch each file from its signed URL, then build the ZIP in memory with
// fflate (see src/lib/zip.ts) so every entry gets a clean, macOS-openable
// local header. Files here are individual tax documents, so the in-memory
// peak is modest.

import { NextResponse, type NextRequest } from "next/server";
import { format } from "date-fns";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { signedUrl } from "@/lib/storage";
import {
  buildZipArchive,
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

  // Firm-scope the engagement lookup. A user from another firm gets
  // an indistinguishable 404 — no existence oracle.
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

  // Exclude byte-identical re-uploads: the original they duplicate is already
  // in the archive, so including them only bloats the zip (and the in-memory
  // build) with redundant copies — a real factor on heavily re-uploaded
  // engagements. Also drop any row missing a storage path (nothing to fetch).
  const realFiles = (files ?? []).filter((f) => !f.is_duplicate && f.storage_path);
  if (realFiles.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 404 });
  }

  // Build the on-disk filename: client - engagement - YYYY-MM-DD.zip.
  // Each part is sanitized so paths and special chars can't escape
  // the Content-Disposition header.
  const clientPart = sanitizeFilenamePart(
    client?.display_name ?? "client",
  );
  const titlePart = sanitizeFilenamePart(engagement.title);
  const datePart = format(new Date(), "yyyy-MM-dd");
  const archiveName = `${clientPart}-${titlePart}-${datePart}.zip`;

  // Record the action up front. If the build dies partway, we still
  // have a log of who tried to pull what.
  await logUserActivity(firm.id, engagement.id, "bulk_download", {
    file_count: realFiles.length,
  });

  // Pull one file's bytes. A file we can't sign or fetch is skipped (returns
  // null) so a single stale/erased object never sinks the whole download. The
  // name is null-safe (macZipEntryName falls back to "untitled").
  async function fetchEntry(f: {
    storage_path: string;
    display_name: string | null;
    original_filename: string | null;
  }): Promise<ZipEntry | null> {
    const url = await signedUrl(f.storage_path, 120).catch(() => null);
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = new Uint8Array(await res.arrayBuffer());
      return { name: macZipEntryName(f.display_name ?? f.original_filename), data };
    } catch {
      return null;
    }
  }

  try {
    // Fetch in BOUNDED PARALLEL so a few dozen documents don't blow the 60s
    // budget on serial round-trips, while capping in-flight bytes (memory).
    const CONCURRENCY = 6;
    const collected: ZipEntry[] = [];
    for (let i = 0; i < realFiles.length; i += CONCURRENCY) {
      const chunk = realFiles.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(fetchEntry));
      for (const r of results) if (r) collected.push(r);
    }

    const zipBytes = await buildZipArchive(collected);

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
    // A build failure used to surface as an opaque crash; return a clean 500
    // (the client shows "couldn't prepare the download") and log enough to
    // diagnose without leaking document contents.
    console.error("[files.zip] build failed", {
      engagement_id: engagement.id,
      file_count: realFiles.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "zip_failed" }, { status: 500 });
  }
}
