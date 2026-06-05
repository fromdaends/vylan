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
import { signedUrl } from "@/lib/storage";
import sharp from "sharp";
import convert from "heic-convert";

export const runtime = "nodejs";
export const maxDuration = 30;

// Default ~2x the on-screen card so retina screens stay crisp; the split detail
// view passes a larger ?w= for a readable full image. Width-only resize keeps
// aspect (the card crops with object-cover; the detail uses object-contain).
// Re-encoding to JPEG also makes HEIC/webp originals display in every browser.
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 120;
const MAX_WIDTH = 2000;

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

  let upstreamUrl: string;
  try {
    upstreamUrl = await signedUrl(file.storage_path, 120);
  } catch {
    return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  }

  let original: Buffer;
  try {
    const res = await fetch(upstreamUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
    }
    original = Buffer.from(await res.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  }

  try {
    // sharp can't decode HEIC/HEIF on its own here — convert to JPEG first
    // (same library the AI image pipeline uses). Everything else (jpeg, png,
    // webp) sharp handles natively.
    let input: Buffer = original;
    if (mime === "image/heic" || mime === "image/heif") {
      const jpeg = (await convert({
        buffer: original as unknown as ArrayBuffer,
        format: "JPEG",
        quality: 0.82,
      })) as ArrayBuffer;
      input = Buffer.from(jpeg);
    }
    const wParam = Number.parseInt(
      request.nextUrl.searchParams.get("w") ?? "",
      10,
    );
    const width = Number.isFinite(wParam)
      ? Math.min(Math.max(wParam, MIN_WIDTH), MAX_WIDTH)
      : DEFAULT_WIDTH;
    const out = await sharp(input)
      .rotate() // honour EXIF orientation (phone photos)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 76 })
      .toBuffer();

    return new Response(new Uint8Array(out), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // Bytes never change for a given file id; cache in the user's browser.
        "Cache-Control": "private, max-age=86400",
        "Content-Length": String(out.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "thumb_failed" }, { status: 500 });
  }
}
