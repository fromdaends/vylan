// Download an arbitrary SELECTION of documents as one ZIP.
//
// DELIVERY — this returns JSON {url}, not the archive bytes, and that is not a
// style choice. The engagement ZIP route records the reason from production:
// Vercel's Node runtime crashes with an instant empty 500 when a route returns
// the archive as its response body — both as a streamed ReadableStream and as a
// buffered Uint8Array, even for a ~1 MB archive, while the build itself is
// fine. So: build the zip, upload it to storage, hand back a short-lived signed
// URL carrying a download disposition. Anything else works locally and dies in
// production.
//
// AUTHORIZATION is per document, through resolveServableDocument — the same
// function the byte and thumbnail routes use. That matters here more than
// anywhere: the ids arrive from the client, so a crafted request must not be
// able to bundle up another firm's documents (or a private client's, or a
// deleted one's). Anything the caller cannot see is silently skipped rather
// than refused, so the response never becomes an existence oracle.
//
// LAYOUT — flat, with names de-duplicated. A selection can span clients, years
// and folders, so there is no meaningful hierarchy to impose; inventing one
// would just make files harder to find in the unzipped folder.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { signedUrl, uploadObject } from "@/lib/storage";
import { zipToBytes, macZipEntryName, asciiFilePart, type ZipEntry } from "@/lib/zip";
import { logUserActivity } from "@/lib/db/activity";
import {
  resolveServableDocument,
  isDocumentSource,
} from "@/lib/files/serve-document";
import type { DocumentSource } from "@/lib/db/documents";

export const runtime = "nodejs";
export const maxDuration = 60;

// Matches the bulk action limit in app/actions/documents.ts. A ZIP is heavier
// than a database update, so this is the ceiling that actually bites.
const MAX_FILES = 200;

export async function GET(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const firm = await getCurrentFirm();
  if (!firm) return NextResponse.json({ error: "no_firm" }, { status: 403 });

  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_FILES);
  if (keys.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 400 });
  }

  // Resolve + authorize each one. Skipping the unreachable ones (rather than
  // failing the whole request) means one stale id in a 200-file selection does
  // not cost the user the other 199.
  const resolved: { path: string; name: string }[] = [];
  let skipped = 0;
  const usedNames = new Set<string>();
  for (const key of keys) {
    const at = key.indexOf(":");
    const source = key.slice(0, at);
    const id = key.slice(at + 1);
    if (!isDocumentSource(source) || !id) {
      skipped++;
      continue;
    }
    const doc = await resolveServableDocument(source as DocumentSource, id);
    if (!doc || doc.deletedAt) {
      skipped++;
      continue;
    }
    // De-duplicate names: a flat archive of "Trial balance.webp" five times
    // would silently keep one file in most unzip tools.
    let name = macZipEntryName(asciiFilePart(doc.fileName, 100) || "document");
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (usedNames.has(`${base} (${n})${ext}`)) n++;
      name = `${base} (${n})${ext}`;
    }
    usedNames.add(name);
    resolved.push({ path: doc.storagePath, name });
  }

  if (resolved.length === 0) {
    return NextResponse.json({ error: "nothing_readable" }, { status: 404 });
  }

  const sb = getServiceRoleSupabase();
  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const f of resolved) {
      const url = await signedUrl(f.path, 300).catch(() => null);
      if (!url) continue;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      yield { name: f.name, data: new Uint8Array(await res.arrayBuffer()) };
    }
  }

  let phase = "build";
  try {
    const bytes = await zipToBytes(entries());
    phase = "upload";
    // One export object per user, overwritten each time — a selection download
    // is transient, and keeping a growing pile of them would quietly consume
    // the firm's storage.
    const exportPath = `firms/${firm.id}/_exports/selection-${auth.user.id}.zip`;
    // The bucket only allows document MIME types and REJECTS application/zip;
    // the signed URL's download disposition is what actually names it .zip.
    // Same workaround (and reason) as the engagement export.
    await uploadObject({
      path: exportPath,
      body: bytes,
      contentType: "application/pdf",
      upsert: true,
    });
    phase = "sign";
    const url = await signedUrl(exportPath, 300, "Vylan documents.zip");

    await logUserActivity(firm.id, null, "bulk_download", {
      file_count: resolved.length,
      skipped,
      surface: "files",
    });
    void sb;
    return NextResponse.json({ url, count: resolved.length, skipped });
  } catch (e) {
    // Named phase, never a bare 500 — and never any document content.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[files/bulk-zip] export failed", {
      firm_id: firm.id,
      phase,
      count: resolved.length,
      message,
    });
    return NextResponse.json({ error: "export_failed", phase }, { status: 500 });
  }
}
