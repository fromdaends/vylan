// Stream a single archived file (any of the three categories) to an
// authenticated firm member. Mirrors /api/files/[id]: authed user → their firm
// → firm-scoped resolve → indistinguishable 404 for anything outside the firm,
// then a native fetch-body passthrough (the only shape Vercel streams without
// crashing). The download is firm+client scoped via resolveArchiveFile.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { signedUrl } from "@/lib/storage";
import { buildContentDisposition } from "@/lib/files/content-disposition";
import { resolveArchiveFile } from "@/lib/archive/download";
import type { ArchiveCategoryKey } from "@/lib/db/client-archive";

export const runtime = "nodejs";
export const maxDuration = 30;

const CATEGORIES: ArchiveCategoryKey[] = ["checklist", "signed", "final"];

function isCategory(value: string): value is ArchiveCategoryKey {
  return (CATEGORIES as string[]).includes(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; category: string; fileId: string }> },
) {
  const { id: clientId, category, fileId } = await params;
  if (!isCategory(category)) {
    return NextResponse.json({ error: "bad_category" }, { status: 404 });
  }

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 403 });
  }

  const resolved = await resolveArchiveFile({
    firmId: firm.id,
    clientId,
    category,
    fileId,
    locale: user?.locale ?? "fr",
  });
  if (!resolved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let upstreamUrl: string;
  try {
    upstreamUrl = await signedUrl(resolved.storagePath, 120);
  } catch {
    return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  }

  // Forward Range so a big PDF can be previewed page-by-page if opened inline.
  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: range ? { Range: range } : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  }

  // The archive's download control passes ?download=1 (save with the clean
  // name); without it the file opens inline (e.g. preview in a new tab).
  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";

  const headers = new Headers();
  headers.set("Content-Type", resolved.mimeType || "application/octet-stream");
  headers.set("Content-Disposition", buildContentDisposition(resolved.filename, wantsDownload));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
