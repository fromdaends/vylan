import { NextResponse, type NextRequest } from "next/server";
import { findItemForToken } from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  MAX_UPLOAD_PARTS,
  isAllowedMime,
  isValidUploadId,
  stagingPartPath,
  removeObjectQuiet,
  uploadObject,
} from "@/lib/storage";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_UPLOAD_CHUNK_PER_TOKEN,
  PORTAL_UPLOAD_CHUNK_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// One ~3.5 MB part of a chunked portal upload. The bytes travel through OUR
// domain (same-origin, so no CORS preflight to fail; each request fits the
// platform's ~4.5 MB function-body cap) into a staging part object. The
// /api/portal/upload-complete route reassembles the parts and runs the
// normal pipeline. See lib/storage.ts for why the browser→Supabase signed
// PUT could not be used (the storage gateway 400s the preflight).

// Hard per-request ceiling: a real part is ~3.5 MB; anything bigger than
// 4 MB is not from our client.
const MAX_PART_BYTES = 4 * 1024 * 1024;

function tooMany(retryAfter?: number) {
  const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (retryAfter) res.headers.set("Retry-After", String(retryAfter));
  return res;
}

export async function POST(request: NextRequest) {
  const ip = ipFromRequest(request);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const token = form.get("token");
  const itemId = form.get("item_id");
  const uploadId = form.get("upload_id");
  const seqRaw = form.get("seq");
  const mime = form.get("mime");
  const chunk = form.get("chunk");

  if (
    typeof token !== "string" ||
    typeof itemId !== "string" ||
    typeof uploadId !== "string" ||
    typeof seqRaw !== "string" ||
    typeof mime !== "string"
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const seq = Number(seqRaw);
  if (
    !isValidUploadId(uploadId) ||
    !Number.isInteger(seq) ||
    seq < 0 ||
    seq >= MAX_UPLOAD_PARTS
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // The bucket enforces its allowed mime list on every object, so parts are
  // stored under the file's REAL declared type (the part bytes are partial,
  // but contentType is just metadata).
  if (!isAllowedMime(mime)) {
    return NextResponse.json({ error: "bad_mime" }, { status: 415 });
  }
  if (!(chunk instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (chunk.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (chunk.size > MAX_PART_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const rlToken = await checkRateLimit({
    key: `portal:uploadchunk:token:${token}`,
    ...PORTAL_UPLOAD_CHUNK_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:uploadchunk:ip:${ip}`,
    ...PORTAL_UPLOAD_CHUNK_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

  const item = await findItemForToken(token, itemId);
  if (!item) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id")
    .eq("id", item.engagement_id)
    .single();
  if (!engagement) {
    return NextResponse.json({ error: "engagement_gone" }, { status: 404 });
  }

  const path = stagingPartPath({
    firmId: engagement.firm_id,
    engagementId: item.engagement_id,
    itemId: item.id,
    uploadId,
    seq,
  });

  try {
    const bytes = Buffer.from(await chunk.arrayBuffer());
    // A retry of the same part (lost response) hits upsert:false → 409-ish
    // error. Replace-on-retry keeps the part route idempotent: remove any
    // prior copy, then write.
    await removeObjectQuiet(path);
    await uploadObject({ path, body: bytes, contentType: mime });
  } catch (e) {
    console.error("[portal/upload-chunk] part store failed:", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, seq });
}
