import { NextResponse, type NextRequest } from "next/server";
import { findItemForToken } from "@/lib/db/portal";
import { ingestPortalUpload } from "@/lib/portal/ingest-upload";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  MAX_BYTES,
  MAX_HEIC_INPUT_BYTES,
  MAX_UPLOAD_PARTS,
  isAllowedMime,
  isHeic,
  isValidUploadId,
  truncateFilename,
  stagingPrefixForItem,
  stagingPartPath,
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

// Step 2 of the staged portal upload: the browser already delivered the raw
// bytes to staging — today as sequential ~3.5 MB parts via
// /api/portal/upload-chunk (same-origin, fits the platform body cap), or via
// the older single-object signed-URL PUT (kept for cached clients; browsers
// can't actually complete that one because the storage gateway 400s its CORS
// preflight, but the contract still works server-side). Validate that the
// staging location belongs to THIS token's checklist item (the prefix is
// re-derived server-side, so a caller can never finalize someone else's
// object), reassemble + download the real bytes, enforce the real size/mime
// limits, then run the exact same pipeline as the legacy in-request route
// (HEIC convert, canonical storage write, duplicate detection, DB row,
// notifications, AI). Staging objects are deleted on every outcome.

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
    upload_id?: unknown;
    total_parts?: unknown;
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
  const uploadId = body?.upload_id;
  const totalParts = body?.total_parts;
  const filename = body?.filename;
  const mime = body?.mime;

  const partsMode =
    typeof uploadId === "string" && typeof totalParts === "number";
  if (
    typeof token !== "string" ||
    typeof itemId !== "string" ||
    typeof filename !== "string" ||
    typeof mime !== "string" ||
    (!partsMode && typeof path !== "string")
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (
    partsMode &&
    (!isValidUploadId(uploadId as string) ||
      !Number.isInteger(totalParts) ||
      (totalParts as number) < 1 ||
      (totalParts as number) > MAX_UPLOAD_PARTS)
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
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

  const scope = {
    firmId: engagement.firm_id,
    engagementId: item.engagement_id,
    itemId: item.id,
  };

  // Resolve the staging object(s) for this upload. Every path is derived
  // from OUR token→item lookup — the ownership gate.
  let stagingPaths: string[];
  if (partsMode) {
    stagingPaths = Array.from({ length: totalParts as number }, (_, seq) =>
      stagingPartPath({ ...scope, uploadId: uploadId as string, seq }),
    );
  } else {
    const expectedPrefix = stagingPrefixForItem(scope);
    const p = path as string;
    if (!p.startsWith(expectedPrefix) || p.includes("..")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    stagingPaths = [p];
  }

  try {
    // Download in order and reassemble. A missing part means the upload
    // never finished (or a lost-response retry already consumed it).
    let bytes: Buffer;
    try {
      const parts: Buffer[] = [];
      for (const p of stagingPaths) {
        parts.push(await downloadObject(p));
      }
      bytes = parts.length === 1 ? parts[0] : Buffer.concat(parts);
    } catch {
      return NextResponse.json({ error: "missing_file" }, { status: 400 });
    }

    // Enforce the REAL limits on the REAL bytes — client-declared sizes were
    // only pre-checks. Oversize/empty assemblies are deleted on the spot
    // (the finally below).
    if (bytes.length === 0) {
      return NextResponse.json({ error: "empty_file" }, { status: 400 });
    }
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: "too_large" }, { status: 413 });
    }
    if (isHeic(mime) && bytes.length > MAX_HEIC_INPUT_BYTES) {
      return NextResponse.json({ error: "heic_too_large" }, { status: 413 });
    }

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
    // staging copies are dead weight on every outcome.
    for (const p of stagingPaths) {
      await removeObjectQuiet(p);
    }
  }
}
