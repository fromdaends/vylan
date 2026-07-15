// Download ONE engagement's whole archive (all three categories) as a ZIP,
// organized "<Category>/<file>" (rejected checklist files under
// "<Checklist>/Rejected/"). Firm+client scoped via collectEngagementArchive.
//
// DELIVERY mirrors /api/engagements/[id]/files.zip: Vercel's Node runtime
// crashes when a route returns archive bytes as its body (streamed OR buffered,
// confirmed in prod), so we build the zip, upload it to storage, and return a
// JSON { url } — a short-lived signed URL whose Content-Disposition forces the
// browser to save it as the real .zip. The client-uploads bucket rejects
// "application/zip", so the object is declared application/pdf (cosmetic; the
// signed URL's download name carries the truth). This is the proven pattern.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { signedUrl, uploadObject } from "@/lib/storage";
import { zipToBytes, type ZipEntry } from "@/lib/zip";
import { collectEngagementArchive } from "@/lib/archive/download";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; engagementId: string }> },
) {
  const { id: clientId, engagementId } = await params;

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

  const bundle = await collectEngagementArchive({
    firmId: firm.id,
    clientId,
    engagementId,
    locale,
  });
  // Out-of-scope engagement → indistinguishable 404 (no cross-firm oracle).
  if (!bundle) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (bundle.files.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 404 });
  }

  const archiveName = bundle.archiveName;

  await logUserActivity(firm.id, engagementId, "bulk_download", {
    file_count: bundle.files.length,
  });

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
    const exportPath = `firms/${firm.id}/_exports/client-archive-eng-${engagementId}.zip`;
    await uploadObject({
      path: exportPath,
      body: zipBytes,
      contentType: "application/pdf",
      upsert: true,
    });
    phase = "sign";
    const url = await signedUrl(exportPath, 300, archiveName);
    return NextResponse.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[client-archive.engagement.zip] export failed", {
      client_id: clientId,
      engagement_id: engagementId,
      phase,
      file_count: bundle.files.length,
      error: message,
    });
    return NextResponse.json({ error: "export_failed", phase, message }, { status: 500 });
  }
}
