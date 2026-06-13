// Firm-wide data export. Owner-role only.
//
// Streams a ZIP containing:
//   * Five CSVs at the root: clients.csv, engagements.csv,
//     request_items.csv, uploaded_files.csv, activity_log.csv.
//   * Every uploaded file under `files/{engagement_id}/{request_item_id}/{filename}`.
//
// Rate-limited to 1 per firm per hour (FIRM_EXPORT_LIMIT). Logs a
// `data_export` activity entry before the stream starts.

import { NextResponse, type NextRequest } from "next/server";
import { format } from "date-fns";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { signedUrl } from "@/lib/storage";
import {
  zipToBytes,
  sanitizeFilenamePart,
  macZipEntryName,
  type ZipEntry,
} from "@/lib/zip";
import { csvDocument } from "@/lib/csv";
import { logUserActivity } from "@/lib/db/activity";
import { checkRateLimit, FIRM_EXPORT_LIMIT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const [firm, user] = await Promise.all([
    getCurrentFirm(),
    getCurrentUser(),
  ]);
  if (!firm || !user) {
    return NextResponse.json({ error: "no_firm" }, { status: 403 });
  }
  if (user.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rl = await checkRateLimit({
    key: `firm_export:firm:${firm.id}`,
    ...FIRM_EXPORT_LIMIT,
  });
  if (!rl.ok) {
    const res = NextResponse.json(
      { error: "rate_limited" },
      { status: 429 },
    );
    if (rl.retryAfter) res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }

  const sb = getServiceRoleSupabase();

  // Fan out all five queries in parallel. Modest data volume per firm
  // (under a few thousand rows total in the early stages); doing them
  // sequentially would add unnecessary latency.
  const [
    { data: clients = [] },
    { data: engagements = [] },
    { data: items = [] },
    { data: files = [] },
    { data: activity = [] },
  ] = await Promise.all([
    sb
      .from("clients")
      .select("id, display_name, email, phone, locale, type, notes, created_at, archived_at")
      .eq("firm_id", firm.id),
    sb
      .from("engagements")
      .select("id, client_id, title, type, status, due_date, sent_at, completed_at, created_at")
      .eq("firm_id", firm.id),
    sb
      .from("request_items")
      .select("id, engagement_id, label, description, doc_type, required, status, approved_at, rejection_reason, engagements!inner(firm_id)")
      .eq("engagements.firm_id", firm.id),
    sb
      .from("uploaded_files")
      .select("id, request_item_id, engagement_id, storage_path, original_filename, mime_type, size_bytes, ai_classification, ai_confidence, uploaded_at, engagements!inner(firm_id)")
      .eq("engagements.firm_id", firm.id),
    sb
      .from("activity_log")
      .select("id, engagement_id, actor_type, action, created_at, metadata")
      .eq("firm_id", firm.id),
  ]);

  // Build the five CSVs in memory. Sizes are bounded — even a heavy
  // firm tops out in the low MB.
  const clientsCsv = csvDocument(
    ["id", "display_name", "email", "phone", "locale", "type", "notes", "created_at", "archived_at"],
    (clients ?? []).map((c) => [
      c.id, c.display_name, c.email, c.phone, c.locale, c.type, c.notes,
      c.created_at, c.archived_at,
    ]),
  );
  const engagementsCsv = csvDocument(
    ["id", "client_id", "title", "type", "status", "due_date", "sent_at", "completed_at", "created_at"],
    (engagements ?? []).map((e) => [
      e.id, e.client_id, e.title, e.type, e.status, e.due_date, e.sent_at,
      e.completed_at, e.created_at,
    ]),
  );
  const requestItemsCsv = csvDocument(
    ["id", "engagement_id", "label", "description", "doc_type", "required", "status", "approved_at", "rejection_reason"],
    (items ?? []).map((i) => [
      i.id, i.engagement_id, i.label, i.description, i.doc_type, i.required,
      i.status, i.approved_at, i.rejection_reason,
    ]),
  );
  const uploadedFilesCsv = csvDocument(
    ["id", "request_item_id", "engagement_id", "original_filename", "mime_type", "size_bytes", "ai_classification", "ai_confidence", "uploaded_at"],
    (files ?? []).map((f) => [
      f.id, f.request_item_id, f.engagement_id, f.original_filename,
      f.mime_type, f.size_bytes, f.ai_classification, f.ai_confidence,
      f.uploaded_at,
    ]),
  );
  const activityCsv = csvDocument(
    ["id", "engagement_id", "actor_type", "action", "created_at", "metadata"],
    (activity ?? []).map((a) => [
      a.id, a.engagement_id, a.actor_type, a.action, a.created_at,
      JSON.stringify(a.metadata ?? {}),
    ]),
  );

  // Activity-log entry up front so we know an export was requested
  // even if the stream is torn down partway.
  await logUserActivity(firm.id, null, "data_export", {
    client_count: clients?.length ?? 0,
    engagement_count: engagements?.length ?? 0,
    file_count: files?.length ?? 0,
  });

  const firmPart = sanitizeFilenamePart(firm.name);
  const archiveName = `${firmPart}-export-${format(new Date(), "yyyy-MM-dd")}.zip`;

  async function* entries(): AsyncGenerator<ZipEntry> {
    yield csvEntry("clients.csv", clientsCsv);
    yield csvEntry("engagements.csv", engagementsCsv);
    yield csvEntry("request_items.csv", requestItemsCsv);
    yield csvEntry("uploaded_files.csv", uploadedFilesCsv);
    yield csvEntry("activity_log.csv", activityCsv);

    // Stream every uploaded file under a stable folder layout. Using
    // engagement_id + request_item_id as the path lets a downstream
    // restore script reattach files to rows from the CSVs.
    for (const f of files ?? []) {
      const url = await signedUrl(f.storage_path, 300).catch(() => null);
      if (!url) continue;
      let res: Response;
      try {
        res = await fetch(url);
      } catch {
        continue;
      }
      if (!res.ok) continue;
      const data = new Uint8Array(await res.arrayBuffer());
      // Export keeps the ORIGINAL filename (the CSVs map rows by it); only the
      // leaf is made archive-safe, the engagement/item UUID folders are intact.
      const safeName = macZipEntryName(f.original_filename);
      yield {
        name: `files/${f.engagement_id}/${f.request_item_id}/${safeName}`,
        data,
      };
    }
  }

  // Buffered response (NOT a streamed ReadableStream — that crashes Vercel's
  // Node runtime; see the engagement files.zip route for the full note). The
  // archive is still built incrementally via zipToBytes; we just collect it
  // before returning.
  const zipBytes = await zipToBytes(entries());
  return new Response(zipBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveName}"`,
      "Content-Length": String(zipBytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

function csvEntry(name: string, body: string): ZipEntry {
  return { name, data: new TextEncoder().encode(body) };
}
