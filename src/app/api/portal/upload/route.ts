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
} from "@/lib/storage";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_UPLOAD_PER_TOKEN,
  PORTAL_UPLOAD_PER_IP,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// LEGACY single-request upload: the file bytes travel in this request's form
// body. The hosting platform caps function request bodies at ~4.5 MB, so this
// path can never carry the full 25 MB the product allows — large phone photos
// and scanned PDFs died here with a generic "upload failed". The portal now
// uploads via /api/portal/upload-url + /upload-complete (browser → storage
// directly, no platform cap) and only falls back here when those endpoints
// are unreachable. Kept fully functional for that fallback + older clients.

function tooMany(retryAfter?: number) {
  const res = NextResponse.json(
    { error: "rate_limited" },
    { status: 429 },
  );
  if (retryAfter) res.headers.set("Retry-After", String(retryAfter));
  return res;
}

export async function POST(request: NextRequest) {
  const ip = ipFromRequest(request);
  const ipForDb = ip === "unknown" ? null : ip;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const token = form.get("token");
  const itemId = form.get("item_id");
  const file = form.get("file");

  if (typeof token !== "string" || typeof itemId !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Rate limit BEFORE touching storage or the DB. Use both the token and
  // the client IP so a single attacker can't burn through a magic link by
  // rotating either dimension.
  const rlToken = await checkRateLimit({
    key: `portal:upload:token:${token}`,
    ...PORTAL_UPLOAD_PER_TOKEN,
  });
  if (!rlToken.ok) return tooMany(rlToken.retryAfter);
  const rlIp = await checkRateLimit({
    key: `portal:upload:ip:${ip}`,
    ...PORTAL_UPLOAD_PER_IP,
  });
  if (!rlIp.ok) return tooMany(rlIp.retryAfter);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  if (!isAllowedMime(file.type)) {
    return NextResponse.json({ error: "bad_mime" }, { status: 415 });
  }
  // Reject oversize HEIC before the decoder gets a chance to OOM on crafted
  // dimensions. Legitimate iPhone photos sit well below this cap.
  if (isHeic(file.type) && file.size > MAX_HEIC_INPUT_BYTES) {
    return NextResponse.json({ error: "heic_too_large" }, { status: 413 });
  }

  const item = await findItemForToken(token, itemId);
  if (!item) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Look up the engagement once — we already have a validated
  // item.engagement_id. firm_id powers storage paths + activity logs; the
  // other fields feed the signed-copy notification inside the shared ingest.
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, firm_id, title, assigned_user_id, client_id")
    .eq("id", item.engagement_id)
    .single();
  if (!engagement) {
    return NextResponse.json({ error: "engagement_gone" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const result = await ingestPortalUpload({
    bytes,
    declaredMime: file.type,
    originalFilename: truncateFilename(file.name),
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
}
