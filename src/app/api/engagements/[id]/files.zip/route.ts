// Bulk-download every uploaded file for a single engagement as a ZIP.
//
// Auth model: the authed firm member is the actor. The route checks that the
// engagement belongs to their firm before doing any work — a stale `id` from
// another firm returns 404.
//
// The archive is STREAMED file-by-file (src/lib/zip.ts streamZip): fetch one
// document, write its entry, release it, then pull the next. Peak memory is a
// single file — never the whole archive. Building the entire zip in one
// in-memory buffer (fflate zipSync) is what previously THREW on big engagements
// and surfaced as the "zip_failed" 500. The streamed response also isn't
// subject to the ~4.5 MB buffered-response cap.

import { NextResponse, type NextRequest } from "next/server";
import { format } from "date-fns";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { signedUrl } from "@/lib/storage";
import {
  streamZip,
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

  // Exclude byte-identical re-uploads: the original they duplicate is already in
  // the archive, so they would only add redundant copies. Drop any row missing a
  // storage path too (nothing to fetch).
  const realFiles = (files ?? []).filter(
    (f) => !f.is_duplicate && f.storage_path,
  );
  if (realFiles.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 404 });
  }

  // On-disk filename: client - engagement - YYYY-MM-DD.zip. Each part is
  // sanitized so paths / special chars can't escape the Content-Disposition.
  const clientPart = sanitizeFilenamePart(client?.display_name ?? "client");
  const titlePart = sanitizeFilenamePart(engagement.title);
  const datePart = format(new Date(), "yyyy-MM-dd");
  const archiveName = `${clientPart}-${titlePart}-${datePart}.zip`;

  // Record the action up front, before streaming, so there's always a log of
  // who pulled what.
  await logUserActivity(firm.id, engagement.id, "bulk_download", {
    file_count: realFiles.length,
  });

  // Stream the archive file-by-file: fetch ONE document, write it, release it,
  // then pull the next. A document we can't sign or fetch is skipped, so one
  // stale / erased object never sinks the whole download. The entry name is
  // null-safe (macZipEntryName falls back to "untitled").
  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const f of realFiles) {
      const url = await signedUrl(f.storage_path, 300).catch(() => null);
      if (!url) continue;
      let data: Uint8Array;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        data = new Uint8Array(await res.arrayBuffer());
      } catch {
        continue;
      }
      yield {
        name: macZipEntryName(f.display_name ?? f.original_filename),
        data,
      };
    }
  }

  // Streamed (chunked) response: no Content-Length because the archive is
  // produced incrementally, and a streamed body isn't subject to the ~4.5 MB
  // buffered-response cap.
  return new Response(streamZip(entries()), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveName}"`,
      "Cache-Control": "no-store",
    },
  });
}
