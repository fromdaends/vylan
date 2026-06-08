// Serve the blank document an accountant uploaded for a signature item (the
// "document to sign") to the UNAUTHENTICATED client portal. That file lives on
// request_items.signing_doc_path, NOT uploaded_files, so the existing file
// endpoints don't cover it — but the authorization is identical in spirit:
//
//   token shape valid -> engagement matches the token -> not cancelled/expired
//   -> the item belongs to THAT engagement -> the item is a signature item with
//      a stored document.
//
// The decision is the pure, unit-tested isSigningDocAccessAllowed(); anything
// outside the token's engagement (or any non-signature item) is an
// indistinguishable 404 (no existence oracle). The client only ever reaches the
// document they were actually asked to sign.
//
// Range requests are forwarded so a PDF viewer can stream just the bytes it
// needs. Content-Type is the stored, upload-validated MIME (pdf / jpeg / png /
// webp only) and, with the global nosniff header, the browser renders it inline
// and never sniffs it into something executable.

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import {
  isSigningDocAccessAllowed,
  type SigningDocItemRow,
} from "@/lib/portal/signing-doc-access";
import type { PortalEngagementRow } from "@/lib/portal/file-access";
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
    key: `portal:signingdoc:token:${token}`,
    ...PORTAL_FILE_VIEW_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:signingdoc:ip:${ip}`,
    ...PORTAL_FILE_VIEW_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, status, magic_expires_at")
    .eq("magic_token", token)
    .maybeSingle();
  const { data: item } = await sb
    .from("request_items")
    .select("engagement_id, kind, signing_doc_path, signing_doc_name, signing_doc_mime")
    .eq("id", id)
    .maybeSingle();

  if (
    !isSigningDocAccessAllowed({
      tokenShapeValid: true,
      engagement: engagement as PortalEngagementRow,
      item: item as SigningDocItemRow,
    })
  ) {
    return notFound();
  }

  // Sign for a short window; we fetch it server-side immediately.
  let upstreamUrl: string;
  try {
    upstreamUrl = await signedUrl(item!.signing_doc_path as string, 120);
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
    (item!.signing_doc_mime as string) || "application/octet-stream",
  );
  headers.set(
    "Content-Disposition",
    buildContentDisposition(
      (item!.signing_doc_name as string) || "document",
      false,
    ),
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
