// Serve a small JPEG thumbnail of an uploaded IMAGE to the UNAUTHENTICATED
// client portal, so a client can see a picture of what they sent (and spot a
// blurry or cut-off photo themselves). There is no session here — the magic
// token in the query is the only identity — so authorization is the whole game:
//
//   token shape valid -> engagement matches the token -> not cancelled/expired
//   -> the requested file belongs to THAT engagement.
//
// The decision lives in the pure, unit-tested isPortalFileAccessAllowed(); a
// file outside the token's engagement is an indistinguishable 404 (no existence
// oracle). Rendering is shared with the accountant grid. PDFs are not served
// here (the portal shows them as a labelled tile for now).

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidTokenShape } from "@/lib/db/portal";
import { isPortalFileAccessAllowed } from "@/lib/portal/file-access";
import {
  renderImageThumbnail,
  clampThumbWidth,
} from "@/lib/files/image-thumbnail";
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token") ?? "";

  // Malformed token never touches the DB — and reads as a plain 404.
  if (!isValidTokenShape(token)) return notFound();

  // Bound render cost per token + per IP (thumbnails are cached for a day, so a
  // legitimate session makes one request per image and never trips this).
  const ip = ipFromRequest(request);
  const rlToken = await checkRateLimit({
    key: `portal:fileview:token:${token}`,
    ...PORTAL_FILE_VIEW_PER_TOKEN,
  });
  if (!rlToken.ok) {
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (rlToken.retryAfter) res.headers.set("Retry-After", String(rlToken.retryAfter));
    return res;
  }
  const rlIp = await checkRateLimit({
    key: `portal:fileview:ip:${ip}`,
    ...PORTAL_FILE_VIEW_PER_IP,
  });
  if (!rlIp.ok) {
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (rlIp.retryAfter) res.headers.set("Retry-After", String(rlIp.retryAfter));
    return res;
  }

  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, status, magic_expires_at")
    .eq("magic_token", token)
    .maybeSingle();
  const { data: file } = await sb
    .from("uploaded_files")
    .select("storage_path, mime_type, engagement_id")
    .eq("id", id)
    .maybeSingle();

  if (
    !isPortalFileAccessAllowed({
      tokenShapeValid: true,
      engagement: engagement as
        | { id: string; status: string; magic_expires_at: string | null }
        | null,
      file: file as { engagement_id: string } | null,
    })
  ) {
    return notFound();
  }

  const mime = (file!.mime_type as string) || "";
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "not_an_image" }, { status: 415 });
  }

  let out: Buffer;
  try {
    out = await renderImageThumbnail(
      file!.storage_path as string,
      mime,
      clampThumbWidth(request.nextUrl.searchParams.get("w")),
    );
  } catch {
    return NextResponse.json({ error: "thumb_failed" }, { status: 502 });
  }

  return new Response(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // Bytes never change for a file id; cache privately in the client's
      // browser only, never on a shared CDN.
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(out.length),
    },
  });
}
