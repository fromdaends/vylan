// Serve a small JPEG thumbnail of an uploaded IMAGE for the Preview grid, so a
// grid of 30+ documents never pulls full-resolution originals. Auth + firm
// scoping mirror api/files/[id] exactly (authed user -> their firm ->
// firm-scoped lookup -> indistinguishable 404). PDFs are NOT handled here — the
// grid renders their first page client-side via pdf.js.

import { NextResponse, type NextRequest } from "next/server";
import {
  renderImageThumbnail,
  clampThumbWidth,
} from "@/lib/files/image-thumbnail";
import {
  resolveServableDocument,
  sourceFromParam,
} from "@/lib/files/serve-document";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ?source= — see the bytes route. Absent = 'checklist', which is every
  // existing caller. Lookup + authorization live in one shared place because
  // the three document tables genuinely have three different RLS rules.
  const source = sourceFromParam(request.nextUrl.searchParams.get("source"));
  const file = await resolveServableDocument(source, id);
  if (!file || file.deletedAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const mime = file.mimeType || "";
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "not_an_image" }, { status: 415 });
  }

  let out: Buffer;
  try {
    out = await renderImageThumbnail(
      file.storagePath,
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
