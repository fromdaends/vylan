// Serve a small JPEG thumbnail of an uploaded IMAGE for the Preview grid, so a
// grid of 30+ documents never pulls full-resolution originals. Auth + firm
// scoping mirror api/files/[id] exactly (authed user -> their firm ->
// firm-scoped lookup -> indistinguishable 404). PDFs are NOT handled here — the
// grid renders their first page client-side via pdf.js.

import { NextResponse, type NextRequest } from "next/server";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  renderImageThumbnail,
  clampThumbWidth,
} from "@/lib/files/image-thumbnail";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 403 });
  }

  const sb = getServiceRoleSupabase();
  const { data: file } = await sb
    .from("uploaded_files")
    .select("storage_path, mime_type, engagement_id")
    .eq("id", id)
    .maybeSingle();
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Authorize the parent engagement via the AUTHED (RLS) client so a private
  // client's thumbnail 404s for STAFF (0810); owners still pass. (See the bytes
  // route.) firm_id eq kept as defense-in-depth on top of RLS.
  const { data: engagement } = await supabase
    .from("engagements")
    .select("id")
    .eq("id", file.engagement_id)
    .eq("firm_id", firm.id)
    .maybeSingle();
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const mime = file.mime_type || "";
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "not_an_image" }, { status: 415 });
  }

  let out: Buffer;
  try {
    out = await renderImageThumbnail(
      file.storage_path,
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
      // Bytes never change for a given file id (uploads are immutable; a
      // re-upload gets a new id), so cache aggressively + immutable. This makes
      // a re-opened or preloaded thumbnail load instantly from cache instead of
      // regenerating the on-demand resize.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(out.length),
    },
  });
}
