// Bulk-download every uploaded file for a single engagement as a ZIP.
//
// Auth model: the authed firm member is the actor. The route checks
// that the engagement belongs to their firm before doing any work — a
// stale `id` from another firm returns 404.
//
// The response streams: we fetch each signed URL on demand and pipe it
// into the archiver. The browser's download starts as soon as the
// first byte hits the wire. Memory stays flat regardless of total
// archive size.

import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "node:stream";
import { format } from "date-fns";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { signedUrl } from "@/lib/storage";
import { streamZip, sanitizeFilenamePart, type ZipEntry } from "@/lib/zip";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
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

  // Firm-scope the engagement lookup. A user from another firm gets
  // an indistinguishable 404 — no existence oracle.
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, title, firm_id, client_id")
    .eq("id", id)
    .eq("firm_id", firm.id)
    .maybeSingle();
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [{ data: client }, { data: files }] = await Promise.all([
    sb
      .from("clients")
      .select("display_name")
      .eq("id", engagement.client_id)
      .maybeSingle(),
    sb
      .from("uploaded_files")
      .select("id, storage_path, original_filename")
      .eq("engagement_id", engagement.id)
      .order("uploaded_at", { ascending: true }),
  ]);

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 404 });
  }

  // Build the on-disk filename: client - engagement - YYYY-MM-DD.zip.
  // Each part is sanitized so paths and special chars can't escape
  // the Content-Disposition header.
  const clientPart = sanitizeFilenamePart(
    client?.display_name ?? "client",
  );
  const titlePart = sanitizeFilenamePart(engagement.title);
  const datePart = format(new Date(), "yyyy-MM-dd");
  const archiveName = `${clientPart}-${titlePart}-${datePart}.zip`;

  // Record the action up front. If the stream dies partway, we still
  // have a log of who tried to pull what.
  await logUserActivity(firm.id, engagement.id, "bulk_download", {
    file_count: files.length,
  });

  async function* entries(): AsyncGenerator<ZipEntry> {
    // Track filename collisions inside the archive — multiple uploads
    // for the same item can have the same original_filename. Suffix
    // collisions so the ZIP itself stays valid.
    const seen = new Map<string, number>();
    for (const f of files!) {
      const url = await signedUrl(f.storage_path, 60).catch(() => null);
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok || !res.body) continue;

      let name = f.original_filename;
      const n = seen.get(name) ?? 0;
      seen.set(name, n + 1);
      if (n > 0) {
        const dot = name.lastIndexOf(".");
        if (dot > 0) {
          name = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
        } else {
          name = `${name} (${n})`;
        }
      }

      yield {
        name,
        stream: Readable.fromWeb(res.body as never),
      };
    }
  }

  const zipStream = streamZip(entries());

  return new Response(zipStream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveName}"`,
      "Cache-Control": "no-store",
    },
  });
}
