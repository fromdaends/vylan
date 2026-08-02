// QuickBooks Stage 4, Phase 3 — firm-wide drafts queue logic (pure).
//
// The queue page groups every draft across the firm into FOUR buckets the
// accountant can filter by. A bucket is derived from the draft's status plus
// (for a still-open draft) whether it is complete:
//
//   needs_input — status 'draft' AND still missing a vendor/account/tax/total
//                 (the accountant must act before it could be posted).
//   ready       — status 'draft' AND complete (one click from approved).
//   approved    — status 'approved' (ready to post in Stage 5).
//   dismissed   — status 'dismissed' (intentionally skipped).
//
// Pure + unit-tested; imported by both the server page (filtering/counting) and
// the client toolbar (filter chip keys) — it pulls in only other pure modules,
// so it is safe to import on either side of the server/client boundary.

import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";
import { normalizeDraftStatus, type DraftStatus } from "./draft-status";
import { draftNeedsInput } from "./draft-resolve";

export const QUEUE_BUCKETS = [
  "needs_input",
  "ready",
  "approved",
  "posted",
  "dismissed",
] as const;
export type QueueBucket = (typeof QUEUE_BUCKETS)[number];

export type QueueItem = {
  suggestion: TransactionSuggestion;
  resolved: ResolvedEntry | null;
  // Defaults to 'draft' when absent / unknown.
  status?: DraftStatus | string | null;
};

// Which bucket a single draft falls into.
export function draftQueueBucket(item: QueueItem): QueueBucket {
  const state = normalizeDraftStatus(item.status ?? null);
  if (state === "posted") return "posted";
  if (state === "approved") return "approved";
  if (state === "dismissed") return "dismissed";
  // status === 'draft': complete ones are "ready", the rest "needs_input".
  return draftNeedsInput(item.suggestion, item.resolved)
    ? "needs_input"
    : "ready";
}

// The filter the toolbar exposes. "all" is the default view and shows every
// draft (posted + dismissed included); the other chips narrow to one bucket.
export const QUEUE_FILTERS = [
  "all",
  "needs_input",
  "ready",
  "approved",
  "posted",
  "dismissed",
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export function parseQueueFilter(v: string | null | undefined): QueueFilter {
  return (QUEUE_FILTERS as readonly string[]).includes(v ?? "")
    ? (v as QueueFilter)
    : "all";
}

// Does a bucket pass the active filter? "all" shows literally EVERY draft
// (posted + dismissed included — each also has its own chip); a specific filter
// shows only that bucket.
export function matchesQueueFilter(
  filter: QueueFilter,
  bucket: QueueBucket,
): boolean {
  if (filter === "all") return true;
  return filter === bucket;
}

// Display priority: the work that needs the accountant floats to the top, then
// the ready-to-approve, then the already-decided. Used to sort the queue so the
// "All" view leads with what needs attention (newest-first within each bucket,
// preserved by a stable sort).
export const QUEUE_BUCKET_RANK: Record<QueueBucket, number> = {
  needs_input: 0,
  ready: 1,
  approved: 2,
  posted: 3,
  dismissed: 4,
};

export function bucketRank(bucket: QueueBucket): number {
  return QUEUE_BUCKET_RANK[bucket];
}

// Which connection scopes the queue's health probe should cover: only clients
// with drafts still AWAITING action (needs_input / ready / approved) — a dead or
// missing connection there will actually block a post. Posted/dismissed rows are
// settled, and the connection behind them may be legitimately retired (e.g. the
// firm-level row after the move to per-client connections), so probing those
// scopes showed a permanent false "reconnect" banner on queues with nothing left
// to post. `undefined` in the result = the legacy firm-level scope, included
// only when an open CLIENT-LESS row exists.
export function queueHealthScopes(
  rows: { clientId: string | null; status?: DraftStatus | string | null }[],
): (string | undefined)[] {
  const open = rows.filter((r) => {
    const s = normalizeDraftStatus(r.status ?? null);
    return s === "draft" || s === "approved";
  });
  const ids = [
    ...new Set(
      open.map((r) => r.clientId).filter((c): c is string => !!c),
    ),
  ];
  return open.some((r) => !r.clientId) ? [...ids, undefined] : ids;
}

// ---------------------------------------------------------------------------
// Queue table sorting (the sortable column headers).
// ---------------------------------------------------------------------------

// How many columns the queue table renders, shared so the expanded detail
// row's colSpan can never drift from the header. It lives HERE, in a plain
// module, because both the client shell and the SERVER-rendered rows read it —
// exporting it from a "use client" file would hand the server a client
// reference instead of the number (the #959 lesson).
export const QUEUE_COLUMN_COUNT = 7;

export type QueueSortKey = "client" | "document" | "amount" | "status";
export type QueueSortDir = "asc" | "desc";

// What a row sorts on. Built server-side, one per rendered row, parallel to
// the children handed to the queue shell.
export type QueueSortMeta = {
  client: string;
  document: string;
  amount: number | null;
  bucket: QueueBucket;
};

// PURE comparator for the queue table.
//
// Rows with no amount sink to the bottom in BOTH directions: an unknown value
// isn't "the smallest", and flipping the arrow shouldn't parade the blanks to
// the top of the page.
export function compareQueueSort(
  a: QueueSortMeta,
  b: QueueSortMeta,
  key: QueueSortKey,
  dir: QueueSortDir,
): number {
  const flip = dir === "asc" ? 1 : -1;
  if (key === "amount") {
    if (a.amount == null && b.amount == null) return 0;
    if (a.amount == null) return 1;
    if (b.amount == null) return -1;
    return (a.amount - b.amount) * flip;
  }
  if (key === "status") {
    return (bucketRank(a.bucket) - bucketRank(b.bucket)) * flip;
  }
  const av = key === "client" ? a.client : a.document;
  const bv = key === "client" ? b.client : b.document;
  // localeCompare so "Sébastien" sorts where a reader expects it rather than
  // after Z, and so case never decides the order.
  return av.localeCompare(bv, undefined, { sensitivity: "base" }) * flip;
}

// The row positions in display order. No chosen column = the server's own
// priority order (needs-input first), untouched.
export function sortedQueueIndexes(
  meta: QueueSortMeta[],
  sort: { key: QueueSortKey; dir: QueueSortDir } | null,
): number[] {
  const idx = meta.map((_, i) => i);
  if (!sort) return idx;
  // Array#sort is stable, so ties keep that same server ordering underneath.
  return idx.sort((x, y) =>
    compareQueueSort(meta[x]!, meta[y]!, sort.key, sort.dir),
  );
}

export type QueueCounts = Record<QueueBucket, number> & { total: number };

// Count how many drafts fall in each bucket (over the WHOLE set, so the toolbar
// chips can show a count regardless of the active filter).
export function countQueueBuckets(items: QueueItem[]): QueueCounts {
  const counts: QueueCounts = {
    needs_input: 0,
    ready: 0,
    approved: 0,
    posted: 0,
    dismissed: 0,
    total: items.length,
  };
  for (const it of items) counts[draftQueueBucket(it)]++;
  return counts;
}
