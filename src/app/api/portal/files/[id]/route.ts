// Stream a single uploaded file's bytes to the UNAUTHENTICATED client portal so
// it can render the file (e.g. a PDF's first page via pdf.js). There is no
// session here; the magic token in the query is the only identity, so
// authorization is the whole game and is identical to the thumbnail endpoint:
//
//   token shape valid -> engagement matches the token -> not cancelled/expired
//   -> the requested file belongs to THAT engagement.
//
// The decision is the pure, unit-tested isPortalFileAccessAllowed(); anything
// outside the token's engagement is an indistinguishable 404 (no existence
// oracle). The client only ever reaches their OWN files (which they uploaded).
//
// Range requests are forwarded so pdf.js can stream just the bytes it needs.
// Content-Type is the stored, upload-validated MIME (pdf / jpeg / png / webp
// only) and, with the global nosniff header, the browser renders it inline and
// never sniffs it into something executable.

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import { isPortalFileAccessAllowed } from "@/lib/portal/file-access";
import { signedUrl } from "@/lib/storage";
import { buildContentDisposition } from "@/lib/files/content-disposition";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_FILE_VIEW_PER_TOKEN,
  PORTAL_FILE_VIEW_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const notFound = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

function tooMany(retryAfter?: number) {
  const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (retryAfter) res.headers.set("Retry-After", String(retryAfter));
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token") ?? "";

  if (!isValidTokenShape(token)) return notFound();

  const ip = ipFromRequest(request);
  const rlToken = await checkRateLimit({
    key: `portal:filebytes:token:${token}`,
    ...PORTAL_FILE_VIEW_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:filebytes:ip:${ip}`,
    ...PORTAL_FILE_VIEW_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, status, magic_expires_at")
    .eq("magic_token", token)
    .maybeSingle();
  const { data: file } = await sb
    .from("uploaded_files")
    .select("storage_path, original_filename, mime_type, engagement_id")
    .eq("id", id)
    .maybeSingle();

  if (
    !isPortalFileAccessAllowed({
      tokenShapeValid: true,
      engagement: engagement as
        | { id: string; status: string; magic_expires_at: string | null }
        | null,
      file: file as { engagement_id: string } | null,
    })
  ) {
    return notFound();
  }

  // Sign for a short window; we fetch it server-side immediately.
  let upstreamUrl: string;
  try {
    upstreamUrl = await signedUrl(file!.storage_path as string, 120);
  } catch {
    return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  }

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

  const headers = new Headers();
  // Trust the stored MIME (validated at upload), combined with global nosniff.
  headers.set(
    "Content-Type",
    (file!.mime_type as string) || "application/octet-stream",
  );
  headers.set(
    "Content-Disposition",
    buildContentDisposition(file!.original_filename as string, false),
  );
  headers.set("Accept-Ranges", "bytes");
  // Private bytes: never cache on a shared CDN.
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
