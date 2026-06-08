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
  const { data: engagement } = await sb
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
      // Bytes never change for a given file id; cache in the user's browser.
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(out.length),
    },
  });
}
