// Stream a single uploaded file's bytes to an authenticated firm member.
//
// Why a proxy instead of handing the browser a Supabase signed URL directly:
//   1. On-demand signing — the in-app document viewer never breaks mid-review
//      when a page-rendered 15-minute signed URL would have expired. An
//      accountant can read a 200-page return for an hour without the bytes
//      404-ing out from under them.
//   2. Same-origin — no cross-origin/CORS surprises for the PDF viewer's range
//      requests; the file is served from our own domain, so the (HttpOnly)
//      session cookie authorises every byte fetch automatically.
//   3. Range passthrough (HTTP 206) — pdf.js asks for only the byte ranges it
//      needs, so the first page of a big multi-page PDF paints in well under a
//      second instead of waiting for the whole file to download.
//   4. Per-request authorisation — every byte request is firm-scoped, never a
//      shareable public URL that could leak a client's documents.
//
// Auth model mirrors api/engagements/[id]/files.zip: authed user → their firm
// → firm-scoped lookup → indistinguishable 404 for anything outside the firm.

import { NextResponse, type NextRequest } from "next/server";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { signedUrl } from "@/lib/storage";
import { buildContentDisposition } from "@/lib/files/content-disposition";

export const runtime = "nodejs";
// Streaming a range chunk is fast; the ceiling only matters if the upstream
// fetch stalls. 30s is plenty and well under the platform timeout.
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
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

  const sb = getServiceRoleSupabase();
  // Find the file, then confirm its engagement belongs to the caller's firm.
  // A file from another firm is an indistinguishable 404 — no existence oracle.
  const { data: file } = await sb
    .from("uploaded_files")
    .select("storage_path, original_filename, display_name, mime_type, engagement_id")
    .eq("id", id)
    .maybeSingle();
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { data: engagement } = await sb
    .from("engagements")
    .select("id")
    .eq("id", file.engagement_id)
    .eq("firm_id", firm.id)
    .maybeSingle();
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Sign for a short window — we fetch it server-side immediately, so the TTL
  // only needs to outlive this one upstream request.
  let upstreamUrl: string;
  try {
    upstreamUrl = await signedUrl(file.storage_path, 120);
  } catch {
    return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  }

  // Forward the browser's Range header so pdf.js can stream pages on demand.
  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: range ? { Range: range } : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  }

  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";

  const headers = new Headers();
  // Trust the stored MIME type (validated at upload) rather than the upstream's
  // — combined with the global `nosniff` header this makes the browser render
  // PDFs/images inline correctly and never sniff something unexpected.
  headers.set("Content-Type", file.mime_type || "application/octet-stream");
  // Download/open as the AI's clean name when we have one, else the original.
  headers.set(
    "Content-Disposition",
    buildContentDisposition(
      file.display_name ?? file.original_filename,
      wantsDownload,
    ),
  );
  headers.set("Accept-Ranges", "bytes");
  // Private bytes: cache only in the user's browser, never on a shared CDN.
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
