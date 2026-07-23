// Documents-received loader. Powers the Documents view — the full parallel of
// the Money view: how many documents the firm received (bucketed over time),
// how many still await review, how fast they get reviewed, and which clients
// send the most. RLS scopes every query to the caller's firm automatically
// (same path ai.ts uses). Duplicates (exact-content re-uploads) are excluded —
// they aren't new documents the firm received.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { aggregateDocuments, type ReceivedDoc } from "./aggregate";
import { resolveRange, type ResolvedRange } from "./range";
import type { DocumentsSection, PerformanceRange } from "./types";

const PAGE = 1000;
const MAX_ROWS = 100_000; // safety backstop against a runaway scan

type ReceivedRow = {
  uploaded_at: string;
  reviewed_at: string | null;
  engagement_id: string;
  is_duplicate: boolean | null;
};

// Every non-duplicate file uploaded in range, with its decision time + owning
// engagement (the engagement carries the client). Counting/bucketing/ranking
// all happen in aggregateDocuments.
async function fetchReceived(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<ReceivedRow[]> {
  const out: ReceivedRow[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
    let q = sb
      .from("uploaded_files")
      .select("id, uploaded_at, reviewed_at, engagement_id, is_duplicate")
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
    const batch = (data ?? []) as unknown as (ReceivedRow & { id: string })[];
    for (const r of batch) {
      if (r.is_duplicate === true) continue;
      out.push(r);
    }
    if (batch.length < PAGE) break;
  }
  return out;
}

// Live count of documents still awaiting the accountant's decision — ANY upload
// date (parallels Outstanding, which is all currently-unpaid invoices). A HEAD
// count so no rows travel. `not.is.true` keeps false + null is_duplicate rows
// and drops only true duplicates.
async function fetchPendingCount(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from("uploaded_files")
    .select("id", { count: "exact", head: true })
    .eq("review_status", "pending")
    .not("is_duplicate", "is", true);
  if (error) {
    console.error("[performance] fetchPendingCount failed:", error);
    return 0;
  }
  return count ?? 0;
}

// Client display names for the received engagements' clients (RLS-scoped).
async function fetchClientNamesForEngagements(
  sb: SupabaseClient,
  engagementIds: string[],
): Promise<{ engToClient: Map<string, string>; names: Map<string, string> }> {
  const engToClient = new Map<string, string>();
  const names = new Map<string, string>();
  if (engagementIds.length === 0) return { engToClient, names };

  for (let i = 0; i < engagementIds.length; i += 300) {
    const { data, error } = await sb
      .from("engagements")
      .select("id, client_id")
      .in("id", engagementIds.slice(i, i + 300));
    if (error) {
      console.error("[performance] fetch engagements failed:", error);
      continue;
    }
    for (const e of (data ?? []) as { id: string; client_id: string | null }[]) {
      if (e.client_id) engToClient.set(e.id, e.client_id);
    }
  }

  const clientIds = [...new Set(engToClient.values())];
  for (let i = 0; i < clientIds.length; i += 300) {
    const { data, error } = await sb
      .from("clients")
      .select("id, display_name")
      .in("id", clientIds.slice(i, i + 300));
    if (error) {
      console.error("[performance] fetch clients failed:", error);
      continue;
    }
    for (const c of (data ?? []) as {
      id: string;
      display_name: string | null;
    }[]) {
      if (c.display_name) names.set(c.id, c.display_name);
    }
  }
  return { engToClient, names };
}

export async function loadDocumentsSection(
  range: ResolvedRange,
): Promise<DocumentsSection> {
  const sb = await getServerSupabase();
  const [rows, pendingReview] = await Promise.all([
    fetchReceived(sb, range),
    fetchPendingCount(sb),
  ]);

  const engIds = [...new Set(rows.map((r) => r.engagement_id))];
  const { engToClient, names } = await fetchClientNamesForEngagements(sb, engIds);

  const docs: ReceivedDoc[] = rows.map((r) => ({
    uploadedMs: Date.parse(r.uploaded_at),
    reviewedMs: r.reviewed_at ? Date.parse(r.reviewed_at) : null,
    clientId: engToClient.get(r.engagement_id) ?? null,
  }));

  return aggregateDocuments(docs, pendingReview, range, names);
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
