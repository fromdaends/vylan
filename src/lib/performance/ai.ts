// AI-performance loader. Fetches the firm's documents that reached a final human
// decision in range (RLS scopes to the firm automatically), resolves the small
// amount of context deriveFileAi needs, and hands everything to aggregateAi.
//
// Duplicates (exact-content re-uploads) are excluded: they are not independent
// AI judgments, and counting them would inflate volume. Auto-rejected documents
// the client later replaced are naturally excluded too — they were never given a
// human approve/reject, so they never enter this decided-in-range set.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import type { FileAiInput } from "@/lib/engagements/file-ai-headline";
import type { DocType } from "@/lib/db/templates";
import { aggregateAi, type AiCandidate } from "./aggregate";
import type { AiScorableFile } from "./ai-verdict";
import { resolveRange, type ResolvedRange } from "./range";
import type { AiSection, PerformanceRange } from "./types";

const PAGE = 1000;
const MAX_ROWS = 50_000; // safety backstop against a runaway scan

type DecidedFileRow = FileAiInput & {
  id: string;
  request_item_id: string;
  engagement_id: string;
  reviewed_at: string | null;
  is_duplicate: boolean | null;
};

const FILE_COLS =
  "id, request_item_id, engagement_id, ai_classification, ai_confidence, ai_usability, ai_rejected, ai_extracted_fields, review_status, uploaded_at, reviewed_at, is_duplicate";

async function fetchDecidedFiles(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<DecidedFileRow[]> {
  const rows: DecidedFileRow[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
    let q = sb
      .from("uploaded_files")
      .select(FILE_COLS)
      .in("review_status", ["approved", "rejected"])
      .not("reviewed_at", "is", null)
      .order("reviewed_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (range.startIso) q = q.gte("reviewed_at", range.startIso);
    const { data, error } = await q;
    if (error) {
      console.error("[performance] fetchDecidedFiles failed:", error);
      break;
    }
    const batch = (data ?? []) as unknown as DecidedFileRow[];
    for (const r of batch) if (r.is_duplicate !== true) rows.push(r);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function fetchMap<T extends { id: string }>(
  sb: SupabaseClient,
  table: string,
  cols: string,
  ids: string[],
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (ids.length === 0) return out;
  // Chunk the id list so a very large all-time set stays within URL limits.
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const { data, error } = await sb.from(table).select(cols).in("id", chunk);
    if (error) {
      console.error(`[performance] fetch ${table} failed:`, error);
      continue;
    }
    for (const row of (data ?? []) as unknown as T[]) out.set(row.id, row);
  }
  return out;
}

function toFileAiInput(f: DecidedFileRow): FileAiInput {
  return {
    ai_classification: f.ai_classification,
    ai_confidence: f.ai_confidence,
    ai_usability: f.ai_usability,
    ai_rejected: f.ai_rejected,
    ai_extracted_fields: f.ai_extracted_fields,
    review_status: f.review_status,
    uploaded_at: f.uploaded_at,
  };
}

export async function loadAiSection(range: ResolvedRange): Promise<AiSection> {
  const sb = await getServerSupabase();
  const nowMs = range.endMs;

  const files = await fetchDecidedFiles(sb, range);
  if (files.length === 0) return aggregateAi([], nowMs);

  const itemIds = [...new Set(files.map((f) => f.request_item_id))];
  const engIds = [...new Set(files.map((f) => f.engagement_id))];
  const [items, engagements] = await Promise.all([
    fetchMap<{ id: string; doc_type: string; ai_rejection_count: number | null }>(
      sb,
      "request_items",
      "id, doc_type, ai_rejection_count",
      itemIds,
    ),
    fetchMap<{
      id: string;
      title: string;
      ai_enabled: boolean | null;
      client_id: string | null;
    }>(sb, "engagements", "id, title, ai_enabled, client_id", engIds),
  ]);
  const clientIds = [
    ...new Set(
      [...engagements.values()]
        .map((e) => e.client_id)
        .filter((id): id is string => id != null),
    ),
  ];
  const clients = await fetchMap<{ id: string; display_name: string | null }>(
    sb,
    "clients",
    "id, display_name",
    clientIds,
  );

  const candidates: AiCandidate[] = files.map((f) => {
    const item = items.get(f.request_item_id);
    const eng = engagements.get(f.engagement_id);
    const aiEnabled = eng?.ai_enabled !== false; // engagements default to AI-on
    const analyzed = f.ai_classification != null && f.ai_confidence != null;
    const decision =
      f.review_status === "approved" || f.review_status === "rejected"
        ? f.review_status
        : null;
    const scorable: AiScorableFile | null =
      analyzed && item && decision
        ? {
            file: toFileAiInput(f),
            expectedDocType: item.doc_type as DocType,
            engagementTitle: eng?.title ?? "",
            clientName: eng?.client_id
              ? clients.get(eng.client_id)?.display_name ?? null
              : null,
            rejectionCount: item.ai_rejection_count ?? 0,
            decision,
          }
        : null;
    return { analyzed, aiEnabled, scorable };
  });

  return aggregateAi(candidates, nowMs);
}

// Convenience for the page: resolve the range and load the AI section in one
// call. The clock is read HERE (a lib function), not in the server component's
// render, so the page stays pure. `nowMs` is injectable for tests.
export async function loadAi(
  range: PerformanceRange,
  nowMs: number = Date.now(),
): Promise<AiSection> {
  return loadAiSection(resolveRange(range, nowMs));
}
