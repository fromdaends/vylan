// Documents-received loader. Counts the firm's client uploads (uploaded_files)
// by upload time, so the Performance chart can show "documents received over
// time" alongside "money collected". RLS scopes every query to the caller's
// firm automatically (same path ai.ts uses). Duplicates (exact-content
// re-uploads) are excluded — they aren't new documents the firm received.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { aggregateDocuments } from "./aggregate";
import { resolveRange, type ResolvedRange } from "./range";
import type { DocumentsSection, PerformanceRange } from "./types";

const PAGE = 1000;
const MAX_ROWS = 100_000; // safety backstop against a runaway scan

// Every non-duplicate uploaded file's upload instant (ms), range-filtered. Only
// the timestamp is needed — the counting/bucketing happens in aggregateDocuments.
async function fetchReceived(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<number[]> {
  const out: number[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
    let q = sb
      .from("uploaded_files")
      .select("id, uploaded_at, is_duplicate")
      // id is the stable tiebreaker: uploaded_at is not unique (a bulk upload
      // stamps many rows within the same instant), so without it a tie
      // straddling a page boundary could be skipped or double-counted.
      .order("uploaded_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (range.startIso) q = q.gte("uploaded_at", range.startIso);
    const { data, error } = await q;
    if (error) {
      console.error("[performance] fetchReceived failed:", error);
      break;
    }
    const batch = (data ?? []) as unknown as {
      uploaded_at: string;
      is_duplicate: boolean | null;
    }[];
    for (const r of batch) {
      if (r.is_duplicate === true) continue;
      const ms = Date.parse(r.uploaded_at);
      if (!Number.isNaN(ms)) out.push(ms);
    }
    if (batch.length < PAGE) break;
  }
  return out;
}

export async function loadDocumentsSection(
  range: ResolvedRange,
): Promise<DocumentsSection> {
  const sb = await getServerSupabase();
  const receivedMs = await fetchReceived(sb, range);
  return aggregateDocuments(receivedMs, range);
}

// Convenience for the page: resolve the range and load documents in one call.
// The clock is read HERE (a lib function), not in the server component's render,
// so the page stays pure. `nowMs` is injectable for tests.
export async function loadDocuments(
  range: PerformanceRange,
  nowMs: number = Date.now(),
): Promise<DocumentsSection> {
  return loadDocumentsSection(resolveRange(range, nowMs));
}
