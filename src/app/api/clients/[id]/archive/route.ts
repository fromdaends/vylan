// Download a client's ENTIRE document archive as one organized ZIP, nested
// "<Engagement>/<Category>/<file>". Firm+client scoped via collectClientArchive.
//
// RELIABILITY (the whole point of this route): a client can have a lot of files.
// The assembled archive is held in memory before upload (zipToBytes), and the
// files are fetched within one function invocation, so an unbounded client would
// eventually OOM or exceed the platform time limit. Rather than crash, we REFUSE
// pathologically large archives up front (413) and the UI steers the user to the
// per-engagement downloads (always small, never capped). The cap is set well
// above any realistic accounting client, so in practice this always builds.
//
// DELIVERY mirrors the other archive ZIP routes: build -> upload to storage ->
// return JSON { url } (Vercel can't return zip bytes as a body). The
// client-uploads bucket rejects "application/zip", so the object is declared
// application/pdf; the signed URL's Content-Disposition carries the real name.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { signedUrl, uploadObject } from "@/lib/storage";
import { zipToBytes, type ZipEntry } from "@/lib/zip";
import { collectClientArchive } from "@/lib/archive/download";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
// The whole-client build fetches many files sequentially; give it the platform
// ceiling. The size cap below keeps the actual work comfortably inside this.
export const maxDuration = 300;

// Refuse-to-crash thresholds. Generous for a real accounting client (hundreds of
// MB of PDFs / slips) but low enough that the in-memory build never OOMs and the
// sequential fetch never blows the 300s wall. Over either → 413 + per-engagement
// fallback in the UI.
const MAX_ARCHIVE_FILES = 400;
const MAX_ARCHIVE_BYTES = 350 * 1024 * 1024;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 403 });
  }
  const locale = user?.locale ?? "fr";

  const bundle = await collectClientArchive({ firmId: firm.id, clientId, locale });
  // Out-of-scope client → indistinguishable 404 (no cross-firm oracle).
  if (!bundle) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (bundle.files.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 404 });
  }
  // Too large to build safely in one request — steer to per-engagement ZIPs.
  if (bundle.files.length > MAX_ARCHIVE_FILES || bundle.estimatedBytes > MAX_ARCHIVE_BYTES) {
    return NextResponse.json(
      { error: "too_large", file_count: bundle.files.length },
      { status: 413 },
    );
  }

  // Fetch each file's bytes and place it at its resolved in-ZIP path. A file we
  // can't sign or fetch is skipped so one stale object never sinks the download.
  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const f of bundle!.files) {
      const url = await signedUrl(f.storagePath, 300).catch(() => null);
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = new Uint8Array(await res.arrayBuffer());
        yield { name: f.path, data };
      } catch {
        continue;
      }
    }
  }

  let phase = "build";
  try {
    const zipBytes = await zipToBytes(entries());
    phase = "upload";
    const exportPath = `firms/${firm.id}/_exports/client-archive-${clientId}.zip`;
    await uploadObject({
      path: exportPath,
      body: zipBytes,
      contentType: "application/pdf",
      upsert: true,
    });
    phase = "sign";
    const url = await signedUrl(exportPath, 300, bundle.archiveName);
    // Activity is engagement-scoped; the whole-client export isn't tied to one,
    // so we log against the firm with a null engagement.
    await logUserActivity(firm.id, null, "bulk_download", {
      client_id: clientId,
      file_count: bundle.files.length,
      scope: "client_archive",
    });
    return NextResponse.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[client-archive.zip] export failed", {
      client_id: clientId,
      phase,
      file_count: bundle.files.length,
      error: message,
    });
    return NextResponse.json({ error: "export_failed", phase, message }, { status: 500 });
  }
}
