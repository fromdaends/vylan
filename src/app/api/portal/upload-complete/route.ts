import { NextResponse, type NextRequest } from "next/server";
import { findItemForToken } from "@/lib/db/portal";
import { ingestPortalUpload } from "@/lib/portal/ingest-upload";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  MAX_BYTES,
  MAX_HEIC_INPUT_BYTES,
  isAllowedMime,
  isHeic,
  truncateFilename,
  stagingPrefixForItem,
  downloadObject,
  removeObjectQuiet,
} from "@/lib/storage";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_UPLOAD_PER_TOKEN,
  PORTAL_UPLOAD_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Step 2 of the direct-to-storage portal upload: the browser already PUT the
// raw bytes to the staging path issued by /api/portal/upload-url. Validate
// that the echoed path belongs to THIS token's checklist item (the prefix is
// re-derived server-side, so a caller can never finalize someone else's
// object), download the real bytes, enforce the real size/mime limits, then
// run the exact same pipeline as the legacy in-request route (HEIC convert,
// canonical storage write, duplicate detection, DB row, notifications, AI).
// The staging object is deleted on every outcome.

function tooMany(retryAfter?: number) {
  const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (retryAfter) res.headers.set("Retry-After", String(retryAfter));
  return res;
}

export async function POST(request: NextRequest) {
  const ip = ipFromRequest(request);
  const ipForDb = ip === "unknown" ? null : ip;

  let body: {
    token?: unknown;
    item_id?: unknown;
    path?: unknown;
    filename?: unknown;
    mime?: unknown;
  } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const token = body?.token;
  const itemId = body?.item_id;
  const path = body?.path;
  const filename = body?.filename;
  const mime = body?.mime;
  if (
    typeof token !== "string" ||
    typeof itemId !== "string" ||
    typeof path !== "string" ||
    typeof filename !== "string" ||
    typeof mime !== "string"
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const rlToken = await checkRateLimit({
    key: `portal:uploadfin:token:${token}`,
    ...PORTAL_UPLOAD_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:uploadfin:ip:${ip}`,
    ...PORTAL_UPLOAD_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

  if (!isAllowedMime(mime)) {
    return NextResponse.json({ error: "bad_mime" }, { status: 415 });
  }

  const item = await findItemForToken(token, itemId);
  if (!item) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, title, assigned_user_id, client_id")
    .eq("id", item.engagement_id)
    .single();
  if (!engagement) {
    return NextResponse.json({ error: "engagement_gone" }, { status: 404 });
  }

  // The ownership gate: the path must sit in the staging prefix derived from
  // OUR token→item lookup, not from anything the client claims.
  const expectedPrefix = stagingPrefixForItem({
    firmId: engagement.firm_id,
    engagementId: item.engagement_id,
    itemId: item.id,
  });
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await downloadObject(path);
  } catch {
    // Nothing was uploaded to the staging path (or it already expired).
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  // Enforce the REAL limits on the REAL bytes — the upload-url pre-checks
  // were client-declared. Oversize/empty objects are deleted on the spot.
  if (bytes.length === 0) {
    await removeObjectQuiet(path);
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (bytes.length > MAX_BYTES) {
    await removeObjectQuiet(path);
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  if (isHeic(mime) && bytes.length > MAX_HEIC_INPUT_BYTES) {
    await removeObjectQuiet(path);
    return NextResponse.json({ error: "heic_too_large" }, { status: 413 });
  }

  try {
    const result = await ingestPortalUpload({
      bytes,
      declaredMime: mime,
      originalFilename: truncateFilename(filename),
      item,
      engagement,
      uploadedByIp: ipForDb,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      file_id: result.fileId,
      ...(result.duplicate ? { duplicate: true } : {}),
    });
  } finally {
    // The canonical object (written by ingest) is what the app reads; the
    // staging copy is dead weight either way.
    await removeObjectQuiet(path);
  }
}
