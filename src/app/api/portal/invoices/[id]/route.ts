import { NextResponse, type NextRequest } from "next/server";
import { isValidTokenShape } from "@/lib/db/portal";
import { getInvoiceAttachmentForDownloadSR } from "@/lib/db/final-documents";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
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
  const response = NextResponse.json(
    { error: "rate_limited" },
    { status: 429 },
  );
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

// Streams the optional invoice document through the authenticated magic-link
// portal. It is deliberately independent of the final-document payment lock:
// clients must be able to read the bill they are being asked to pay.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const asDownload = request.nextUrl.searchParams.get("download") === "1";
  if (!isValidTokenShape(token)) return notFound();

  const [tokenLimit, ipLimit] = await Promise.all([
    checkRateLimit({
      key: `portal:invoice:token:${token}`,
      ...PORTAL_FILE_VIEW_PER_TOKEN,
    }),
    checkRateLimit({
      key: `portal:invoice:ip:${ipFromRequest(request)}`,
      ...PORTAL_FILE_VIEW_PER_IP,
    }),
  ]);
  if (!tokenLimit.ok) return tooMany(tokenLimit.retryAfter);
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfter);

  const sb = getServiceRoleSupabase();
  const [{ data: engagement }, attachment] = await Promise.all([
    sb
      .from("engagements")
      .select("id, status, magic_expires_at")
      .eq("magic_token", token)
      .maybeSingle(),
    getInvoiceAttachmentForDownloadSR(id),
  ]);
  const expired =
    engagement?.magic_expires_at &&
    new Date(engagement.magic_expires_at as string).getTime() <= Date.now();
  if (
    !engagement ||
    engagement.status === "cancelled" ||
    expired ||
    !attachment ||
    attachment.engagement_id !== engagement.id
  ) {
    return notFound();
  }

  let upstreamUrl: string;
  try {
    upstreamUrl = await signedUrl(attachment.storage_path, 120);
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
  headers.set("Content-Type", attachment.mime_type || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    buildContentDisposition(attachment.original_filename, asDownload),
  );
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
