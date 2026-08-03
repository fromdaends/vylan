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
//
// A download here is recorded as `client_downloaded_deliverable` on the CLIENT
// activity feed, and deliberately NOT as `file_downloaded` on the firm audit
// log. Two different ledgers, two different actors: the firm audit answers "who
// at this firm touched a client's documents", and its rows carry a firm user as
// the actor. A portal visitor has no firm session, so a `file_downloaded` row
// for one would carry a null actor and read on /settings/audit as an
// unattributed member of staff — worse than silence. The client's own action
// already has its own registered, filterable audit action, and it shows up on
// that screen under its own name.
//
// It is recorded HERE rather than from the Download link's onClick for the same
// reason /api/files/[id] does it: a beacon fired from a component only covers
// the one component that fires it, and misses "Save link as", a copied URL, or
// a page that navigates away before the beacon leaves.

import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { isValidTokenShape, logActivity } from "@/lib/db/portal";
import { countsAsDownload } from "@/lib/files/download-audit";
import { isPortalUnlocked } from "@/lib/portal/gate";
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

  // PIN gate. This route resolves the token itself instead of going through
  // findEngagementForToken, so it has to ask. Placed AFTER the rate limit so a
  // flood of well-formed guesses is still bounded before it reaches the DB.
  if (!(await isPortalUnlocked(token))) return notFound();

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, status, magic_expires_at, invoice_locks_deliverables")
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

  // Same gate as the firm-side routes — only ?download=1, and only the first
  // byte range, so an inline preview writes nothing and a resumed transfer
  // writes one row rather than one per chunk.
  const firmId = (engagement as { firm_id?: string | null } | null)?.firm_id;
  if (firmId && countsAsDownload({ wantsDownload: asDownload, range })) {
    const engagementId = engagement!.id as string;
    const name = deliverable!.display_name || deliverable!.original_filename;
    // Off the response path and best-effort: the client's file must never wait
    // on, or be denied by, the row that records it.
    after(async () => {
      try {
        await logActivity(firmId, engagementId, "client_downloaded_deliverable", {
          name,
          ref: id,
        });
      } catch (e) {
        console.error("[portal] could not record a deliverable download:", e);
      }
    });
  }

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
