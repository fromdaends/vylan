import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { findItemForToken } from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  MAX_BYTES,
  MAX_HEIC_INPUT_BYTES,
  isAllowedMime,
  isHeic,
  truncateFilename,
  stagingUploadPath,
  createUploadUrl,
} from "@/lib/storage";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_UPLOAD_PER_TOKEN,
  PORTAL_UPLOAD_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// Step 1 of the direct-to-storage portal upload: validate the magic token +
// the file's declared shape, then hand the browser a short-lived signed URL
// pointing at a server-chosen STAGING path. The browser PUTs the bytes there
// itself (no ~4.5 MB platform body cap — the whole reason this flow exists;
// large phone photos and scanned PDFs used to die with "upload failed"), and
// /api/portal/upload-complete then validates the real bytes and runs the
// normal pipeline. Size/mime here are client-declared pre-checks for fast
// feedback; the complete route re-checks against the actual stored bytes.

function tooMany(retryAfter?: number) {
  const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (retryAfter) res.headers.set("Retry-After", String(retryAfter));
  return res;
}

export async function POST(request: NextRequest) {
  const ip = ipFromRequest(request);

  let body: {
    token?: unknown;
    item_id?: unknown;
    filename?: unknown;
    mime?: unknown;
    size?: unknown;
  } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const token = body?.token;
  const itemId = body?.item_id;
  const filename = body?.filename;
  const mime = body?.mime;
  const size = body?.size;
  if (
    typeof token !== "string" ||
    typeof itemId !== "string" ||
    typeof filename !== "string" ||
    typeof mime !== "string" ||
    typeof size !== "number"
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Same dual rate limiting as the legacy upload route, on its own keys so a
  // normal session (one url + one complete per file) doesn't double-bill the
  // legacy budget.
  const rlToken = await checkRateLimit({
    key: `portal:uploadurl:token:${token}`,
    ...PORTAL_UPLOAD_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:uploadurl:ip:${ip}`,
    ...PORTAL_UPLOAD_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

  if (size <= 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  if (!isAllowedMime(mime)) {
    return NextResponse.json({ error: "bad_mime" }, { status: 415 });
  }
  if (isHeic(mime) && size > MAX_HEIC_INPUT_BYTES) {
    return NextResponse.json({ error: "heic_too_large" }, { status: 413 });
  }

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

  const path = stagingUploadPath({
    firmId: engagement.firm_id,
    engagementId: item.engagement_id,
    itemId: item.id,
    uuid: nanoid(12),
    filename: truncateFilename(filename),
  });

  try {
    const { signedUrl } = await createUploadUrl(path);
    return NextResponse.json({ signed_url: signedUrl, path });
  } catch (e) {
    console.error("[portal/upload-url] signed upload URL failed:", e);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
