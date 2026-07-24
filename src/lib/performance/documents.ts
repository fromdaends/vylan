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

// The 0820 "count but don't name" RPCs may not be applied yet — PostgREST
// reports an unknown function as PGRST202 / 42883, in which case we fall back to
// the RLS-scoped read (which undercounts private clients for staff until 0820).
function isMissingFunction(err: { code?: string } | null): boolean {
  return err?.code === "PGRST202" || err?.code === "42883";
}

// One received file, with its client already resolved (and, from the RPC,
// redacted to null for staff on private clients).
type ReceivedResolved = {
  uploaded_at: string;
  reviewed_at: string | null;
  client_id: string | null;
  is_duplicate: boolean | null;
};

// Every file uploaded in range, firm-wide INCLUDING private clients (so staff
// totals are complete). Tries the 0820 definer RPC first (which resolves +
// redacts the client id); falls back to the RLS-scoped read on an un-migrated DB.
async function fetchReceived(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<ReceivedResolved[]> {
  const { data, error } = await sb.rpc("perf_received_docs", {
    p_start: range.startIso ?? null,
  });
  if (!error) {
    return ((data ?? []) as unknown as ReceivedResolved[]).filter(
      (r) => r.is_duplicate !== true,
    );
  }
  if (!isMissingFunction(error)) {
    console.error("[performance] perf_received_docs rpc failed:", error);
  }
  return fetchReceivedViaRls(sb, range);
}

// RLS fallback: page uploaded_files, then resolve each file's client through its
// engagement (both RLS-scoped, so private clients are simply absent for staff).
async function fetchReceivedViaRls(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<ReceivedResolved[]> {
  const rows: {
    uploaded_at: string;
    reviewed_at: string | null;
    engagement_id: string;
    is_duplicate: boolean | null;
  }[] = [];
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
    const batch = (data ?? []) as unknown as (typeof rows)[number][];
    for (const r of batch) {
      if (r.is_duplicate === true) continue;
      rows.push(r);
    }
    if (batch.length < PAGE) break;
  }

  const engIds = [...new Set(rows.map((r) => r.engagement_id))];
  const engToClient = new Map<string, string>();
  for (let i = 0; i < engIds.length; i += 300) {
    const { data, error } = await sb
      .from("engagements")
      .select("id, client_id")
      .in("id", engIds.slice(i, i + 300));
    if (error) {
      console.error("[performance] fetch engagements failed:", error);
      continue;
    }
    for (const e of (data ?? []) as { id: string; client_id: string | null }[]) {
      if (e.client_id) engToClient.set(e.id, e.client_id);
    }
  }
  return rows.map((r) => ({
    uploaded_at: r.uploaded_at,
    reviewed_at: r.reviewed_at,
    client_id: engToClient.get(r.engagement_id) ?? null,
    is_duplicate: r.is_duplicate,
  }));
}

// Live count of documents still awaiting the accountant's decision — ANY upload
// date. Firm-wide INCLUDING private clients via the 0820 RPC; RLS fallback (a
// HEAD count, no rows travel) undercounts private for staff until 0820 lands.
async function fetchPendingCount(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc("perf_pending_docs_count");
  if (!error) return (data as number | null) ?? 0;
  if (!isMissingFunction(error)) {
    console.error("[performance] perf_pending_docs_count rpc failed:", error);
  }
  const { count, error: rlsErr } = await sb
    .from("uploaded_files")
    .select("id", { count: "exact", head: true })
    .eq("review_status", "pending")
    .not("is_duplicate", "is", true);
  if (rlsErr) {
    console.error("[performance] fetchPendingCount failed:", rlsErr);
    return 0;
  }
  return count ?? 0;
}

// Client display names (RLS-scoped): private clients' names are ABSENT for staff
// (so they fall out of the "top clients" ranking — count but don't name) and
// PRESENT for owners (who see everything). Keyed by client_id.
async function fetchClientNames(
  sb: SupabaseClient,
  clientIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
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
  return names;
}

export async function loadDocumentsSection(
  range: ResolvedRange,
): Promise<DocumentsSection> {
  const sb = await getServerSupabase();
  const [rows, pendingReview] = await Promise.all([
    fetchReceived(sb, range),
    fetchPendingCount(sb),
  ]);

  const clientIds = [
    ...new Set(
      rows.map((r) => r.client_id).filter((id): id is string => id != null),
    ),
  ];
  const names = await fetchClientNames(sb, clientIds);

  const docs: ReceivedDoc[] = rows.map((r) => ({
    uploadedMs: Date.parse(r.uploaded_at),
    reviewedMs: r.reviewed_at ? Date.parse(r.reviewed_at) : null,
    clientId: r.client_id,
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
