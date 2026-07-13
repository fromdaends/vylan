// Stream a single "final document" (accountant deliverable) to the UNAUTHENTICATED
// client portal. This is the ONLY path by which a client reaches deliverable bytes
// — the portal never embeds a direct signed URL for these — so it is the single
// server-side choke point for the Final documents lock.
//
// Authorization is the pure, unit-tested isDeliverableDownloadAllowed():
//   token shape valid -> engagement matches the token -> not cancelled/expired
//   -> the deliverable belongs to THAT engagement -> (Phase 4) not locked.
// Anything else is an indistinguishable 404 (no existence oracle).
//
// ?download=1 forces an attachment (the portal's Download link); otherwise the
// browser renders it inline (PDF preview), using the stored, upload-validated MIME
// plus the global nosniff header.

import { NextResponse, type NextRequest } from "next/server";
import { isValidTokenShape } from "@/lib/db/portal";
import {
  isDeliverableDownloadAllowed,
  computeDeliverablesLocked,
} from "@/lib/portal/deliverable-access";
import { getFinalDocumentForDownloadSR } from "@/lib/db/final-documents";
import { getLatestPaymentRequestForEngagementSR } from "@/lib/db/payment-requests";
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
  const asDownload = request.nextUrl.searchParams.get("download") === "1";

  if (!isValidTokenShape(token)) return notFound();

  const ip = ipFromRequest(request);
  const rlToken = await checkRateLimit({
    key: `portal:deliverable:token:${token}`,
    ...PORTAL_FILE_VIEW_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:deliverable:ip:${ip}`,
    ...PORTAL_FILE_VIEW_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, status, magic_expires_at, invoice_locks_deliverables")
    .eq("magic_token", token)
    .maybeSingle();
  const deliverable = await getFinalDocumentForDownloadSR(id);

  // The deliverables lock: gate the download when the finished work is locked and
  // unpaid. Derived from trusted server state (never the client): the current
  // invoice row when one exists, else the engagement's captured lock preference
  // (deferred invoices create the row late — the lock must still hold, and this
  // makes a payment-read failure fail CLOSED rather than serve a locked file).
  let locked = false;
  if (engagement?.id) {
    const invoice = await getLatestPaymentRequestForEngagementSR(engagement.id);
    locked = computeDeliverablesLocked({
      invoice,
      engagementLocksDeliverables:
        (engagement as { invoice_locks_deliverables?: boolean })
          .invoice_locks_deliverables === true,
    });
  }

  if (
    !isDeliverableDownloadAllowed({
      tokenShapeValid: true,
      engagement: engagement as
        | { id: string; status: string; magic_expires_at: string | null }
        | null,
      deliverable: deliverable
        ? { engagement_id: deliverable.engagement_id }
        : null,
      locked,
    })
  ) {
    return notFound();
  }

  // Sign for a short window; fetched server-side immediately.
  let upstreamUrl: string;
  try {
    upstreamUrl = await signedUrl(deliverable!.storage_path, 120);
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
  headers.set(
    "Content-Type",
    deliverable!.mime_type || "application/octet-stream",
  );
  headers.set(
    "Content-Disposition",
    buildContentDisposition(deliverable!.original_filename, asDownload),
  );
  headers.set("Accept-Ranges", "bytes");
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
