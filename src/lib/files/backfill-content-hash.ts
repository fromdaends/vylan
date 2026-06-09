import type { SupabaseClient } from "@supabase/supabase-js";
import { computeContentHash } from "@/lib/files/content-hash";

// Self-draining content_hash backfill for duplicate detection.
//
// Files uploaded BEFORE migration 0270 have content_hash = NULL, so they are
// invisible to duplicate detection: a new upload can never match them, and
// engagements whose uploads predate the feature can never surface duplicates.
// This sweep hashes a small batch of legacy files per cron run (oldest first)
// until none remain — additive column fills only, no review state is touched,
// and nothing is retroactively marked as a duplicate (that re-bucketing is a
// deliberate non-goal; only FUTURE uploads compare against the new hashes).
//
// A file whose bytes can't be downloaded (deleted object, corrupt path) gets
// the sentinel below instead of NULL so the sweep always drains instead of
// retrying the same broken row forever. The sentinel is not 64-hex, so it can
// never equal a real SHA-256 from a new upload — sentinel rows are inert for
// matching (findDuplicateOriginalId compares against the NEW file's hash).
export const BACKFILL_FAILED_SENTINEL = "backfill_unavailable";

// Batch size per cron run: small enough to never threaten the cron's 60s
// budget (6 downloads + hashes), large enough to drain hundreds of legacy
// files within a day at the 2-minute cadence.
export const BACKFILL_BATCH_SIZE = 6;

// Per-file download budget. A stalled storage download must never push the
// cron past its 60s hard limit — past this, the file is marked with the
// sentinel (same as a failed download) and the sweep moves on.
const DOWNLOAD_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("download_timeout")),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export type BackfillResult = {
  scanned: number;
  hashed: number;
  failed: number;
};

export async function backfillContentHashes(
  supabase: SupabaseClient,
  limit: number = BACKFILL_BATCH_SIZE,
): Promise<BackfillResult> {
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("id, storage_path")
    .is("content_hash", null)
    .order("uploaded_at", { ascending: true })
    .limit(limit);
  if (error || !data || data.length === 0) {
    return { scanned: 0, hashed: 0, failed: 0 };
  }

  let hashed = 0;
  let failed = 0;
  for (const row of data as { id: string; storage_path: string }[]) {
    let hash: string;
    try {
      const { data: blob, error: dlErr } = await withTimeout(
        supabase.storage.from("client-uploads").download(row.storage_path),
        DOWNLOAD_TIMEOUT_MS,
      );
      if (dlErr || !blob) throw dlErr ?? new Error("download_empty");
      hash = computeContentHash(Buffer.from(await blob.arrayBuffer()));
      hashed++;
    } catch {
      hash = BACKFILL_FAILED_SENTINEL;
      failed++;
    }
    // The NULL guard keeps this strictly a backfill: never overwrite a hash
    // some other path wrote in the meantime.
    await supabase
      .from("uploaded_files")
      .update({ content_hash: hash })
      .eq("id", row.id)
      .is("content_hash", null);
  }
  return { scanned: data.length, hashed, failed };
}
