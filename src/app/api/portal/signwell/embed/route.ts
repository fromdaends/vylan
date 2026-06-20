// Return a fresh EMBEDDED signing URL for a signature item to the unauthenticated
// client portal. The client signs inside Vylan (embedded iframe); they are never
// redirected to signwell.com.
//
// Authorization mirrors the uploaded-file rule: token shape valid -> engagement
// matches the token -> not cancelled/expired -> the item belongs to THAT
// engagement -> the item is a signature item. Anything else is an
// indistinguishable 404 (no existence oracle).
//
// The SignWell API key is used server-side only (getDocument); it never reaches
// the browser. Embedded signing URLs can expire, so we fetch a fresh one here on
// demand rather than storing it.

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import {
  isPortalFileAccessAllowed,
  type PortalEngagementRow,
} from "@/lib/portal/file-access";
import { getSignatureRequestByItemSR } from "@/lib/db/signature-requests";
import { getDocument } from "@/lib/signwell/client";
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

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const itemId = request.nextUrl.searchParams.get("item_id") ?? "";

  if (!isValidTokenShape(token) || !itemId) return notFound();

  const ip = ipFromRequest(request);
  const rlToken = await checkRateLimit({
    key: `portal:signwell:embed:token:${token}`,
    ...PORTAL_FILE_VIEW_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:signwell:embed:ip:${ip}`,
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
    .select("engagement_id, kind")
    .eq("id", itemId)
    .maybeSingle();

  // Same strict engagement-ownership + expiry check as uploaded files, plus the
  // item must be a signature item.
  if (
    !isPortalFileAccessAllowed({
      tokenShapeValid: true,
      engagement: engagement as PortalEngagementRow,
      file: item ? { engagement_id: item.engagement_id as string } : null,
    }) ||
    (item as { kind?: string } | null)?.kind !== "signature"
  ) {
    return notFound();
  }

  const sr = await getSignatureRequestByItemSR(itemId);
  if (!sr || !sr.signwell_document_id) {
    // No SignWell document yet (setup incomplete) — not an error the client can
    // act on; tell the card it is not ready to sign.
    return NextResponse.json({ status: sr?.status ?? "pending" });
  }
  // Already signed: nothing to open.
  if (sr.status === "completed") {
    return NextResponse.json({ status: "completed" });
  }

  try {
    const doc = await getDocument(sr.signwell_document_id);
    if (doc.status === "completed") {
      return NextResponse.json({ status: "completed" });
    }
    if (!doc.embeddedSigningUrl) {
      return NextResponse.json({ status: doc.status });
    }
    return NextResponse.json({
      status: doc.status,
      embedded_signing_url: doc.embeddedSigningUrl,
    });
  } catch {
    return NextResponse.json({ error: "signwell_error" }, { status: 502 });
  }
}
