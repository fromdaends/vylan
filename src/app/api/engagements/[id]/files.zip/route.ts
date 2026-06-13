// TEMPORARY DIAGNOSTIC build of the bulk-download route.
//
// The real download keeps failing with an instant HTTP 500 + empty body in
// production (but works locally), and there's no way to read the server stack.
// So this version REPORTS what's happening as JSON the accountant can read in
// the Network tab: which phase ran, file count + sizes (NO filenames, NO
// contents), and whether building the zip SERVER-SIDE succeeds or throws (with
// the stack). This pins the crash down precisely; then the real fix ships and
// this is removed.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { signedUrl } from "@/lib/storage";
import { streamZip, macZipEntryName, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";
export const maxDuration = 60;

const head = (e: unknown, n = 8) =>
  e instanceof Error ? String(e.stack ?? e.message).split("\n").slice(0, n) : [String(e)];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let phase = "start";
  try {
    phase = "params";
    const { id } = await params;

    phase = "auth";
    const supabase = await getServerSupabase();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ diag: true, stop: "unauth" }, { status: 200 });

    phase = "firm";
    const firm = await getCurrentFirm();
    if (!firm) return NextResponse.json({ diag: true, stop: "no_firm" }, { status: 200 });

    phase = "engagement";
    const sb = getServiceRoleSupabase();
    const { data: engagement, error: engErr } = await sb
      .from("engagements")
      .select("id, title, firm_id, client_id")
      .eq("id", id)
      .eq("firm_id", firm.id)
      .maybeSingle();
    if (engErr) return NextResponse.json({ diag: true, phase, engErr: engErr.message }, { status: 200 });
    if (!engagement) return NextResponse.json({ diag: true, stop: "not_found" }, { status: 200 });

    phase = "files";
    const { data: files, error: filesErr } = await sb
      .from("uploaded_files")
      .select("id, storage_path, original_filename, display_name, size_bytes, mime_type, is_duplicate")
      .eq("engagement_id", engagement.id)
      .order("uploaded_at", { ascending: true });
    if (filesErr) return NextResponse.json({ diag: true, phase, filesErr: filesErr.message }, { status: 200 });

    const list = files ?? [];
    const real = list.filter((f) => !f.is_duplicate && f.storage_path);
    const totalMB = +(real.reduce((s, f) => s + (f.size_bytes ?? 0), 0) / 1e6).toFixed(1);
    const largestMB = +(real.reduce((m, f) => Math.max(m, f.size_bytes ?? 0), 0) / 1e6).toFixed(1);
    const report: Record<string, unknown> = {
      diag: true,
      fileCount: list.length,
      realCount: real.length,
      totalMB,
      largestMB,
      mimes: [...new Set(list.map((f) => f.mime_type))],
      nullName: list.filter((f) => !f.display_name && !f.original_filename).length,
      nullPath: list.filter((f) => !f.storage_path).length,
    };

    phase = "build";
    async function* entries(): AsyncGenerator<ZipEntry> {
      for (const f of real) {
        const url = await signedUrl(f.storage_path, 300).catch(() => null);
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = new Uint8Array(await res.arrayBuffer());
          yield { name: macZipEntryName(f.display_name ?? f.original_filename), data };
        } catch {
          continue;
        }
      }
    }
    try {
      const reader = streamZip(entries()).getReader();
      let bytes = 0;
      let chunks = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        chunks += 1;
      }
      report.buildOk = true;
      report.zipMB = +(bytes / 1e6).toFixed(1);
      report.chunks = chunks;
    } catch (e) {
      report.buildOk = false;
      report.buildError = e instanceof Error ? e.message : String(e);
      report.buildStack = head(e);
    }

    return NextResponse.json(report, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { diag: true, failedAt: phase, error: e instanceof Error ? e.message : String(e), stack: head(e) },
      { status: 200 },
    );
  }
}
