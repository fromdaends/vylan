// Pure aggregation for the Performance page. NO database, NO server imports —
// the loaders (ai.ts / money.ts) fetch rows and hand them here so this counting
// logic is unit-tested directly. Every number is a plain reduction over records.

import { scoreFile, type AiScorableFile } from "./ai-verdict";
import {
  bucketStartMs,
  easternYmd,
  enumerateBuckets,
  type ResolvedRange,
} from "./range";
import {
  AI_EARLY_DATA_THRESHOLD,
  LOCK_SPLIT_MIN_SAMPLE,
  TOP_CLIENTS_LIMIT,
  type AiSection,
  type CountBucket,
  type DocumentsSection,
  type FourCase,
  type MoneyBucket,
  type MoneySection,
  type TopClient,
  type TopDocClient,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Mean of a list, or null when empty (never fabricate a 0 average). Shared by
// the money and documents turnaround stats.
const avg = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// ── AI ──────────────────────────────────────────────────────────────────────

// One document that reached a final human decision in range, pre-classified by
// the loader into the three volume buckets: assessed (AI on + verdict on file),
// AI-off, or not-analyzed. `scorable` is present iff it can be verdict-replayed.
export type AiCandidate = {
  analyzed: boolean;
  aiEnabled: boolean;
  scorable: AiScorableFile | null;
};

const emptyCases = (): Record<FourCase, number> => ({
  true_pass: 0,
  true_catch: 0,
  false_pass: 0,
  false_alarm: 0,
});

export function aggregateAi(
  candidates: AiCandidate[],
  nowMs: number,
): AiSection {
  const cases = emptyCases();
  let assessedCount = 0;
  let skippedAiOffCount = 0;
  let notAnalyzedCount = 0;

  for (const c of candidates) {
    // AI-off wins first: such a file never gets a verdict, so it can only be
    // "skipped", never assessed.
    if (!c.aiEnabled) {
      skippedAiOffCount++;
      continue;
    }
    if (!c.analyzed || !c.scorable) {
      notAnalyzedCount++;
      continue;
    }
    cases[scoreFile(c.scorable, nowMs)]++;
    assessedCount++;
  }

  const agreementCount = cases.true_pass + cases.true_catch;
  return {
    assessedCount,
    agreementCount,
    agreementRate: assessedCount === 0 ? null : agreementCount / assessedCount,
    cases,
    skippedAiOffCount,
    notAnalyzedCount,
    earlyData: assessedCount < AI_EARLY_DATA_THRESHOLD,
  };
}

// ── Documents received ───────────────────────────────────────────────────────

// Inclusive count of Eastern calendar months spanned by [fromMs, toMs]. Used to
// turn a total into a per-month average. Always ≥ 1.
function monthsCovered(fromMs: number, toMs: number): number {
  const a = easternYmd(fromMs);
  const b = easternYmd(toMs);
  return Math.max(1, (b.y - a.y) * 12 + (b.mo - a.mo) + 1);
}

// One document received (uploaded) in range: its upload instant, its decision
// instant (null if still pending/never decided), and which client sent it.
export type ReceivedDoc = {
  uploadedMs: number;
  reviewedMs: number | null;
  clientId: string | null;
};

// The whole Documents view in one pure reduction: per-period counts, per-month
// average, upload→decision turnaround, and the clients who sent the most.
// `pendingReview` is a live count (docs still awaiting a decision, ANY upload
// date) resolved by the loader, so it's threaded in rather than derived here.
// Mirrors aggregateMoney's bucketing exactly (empty periods render as zero).
export function aggregateDocuments(
  docs: ReceivedDoc[],
  pendingReview: number,
  range: ResolvedRange,
  clientNames: Map<string, string> = new Map(),
): DocumentsSection {
  const totalReceived = docs.length;

  // For all_time the span starts at the earliest upload (or now, if none).
  const fromMs =
    range.startMs ??
    (docs.length ? Math.min(...docs.map((d) => d.uploadedMs)) : range.endMs);

  const byBucket = new Map<number, number>();
  for (const start of enumerateBuckets(fromMs, range.endMs, range.granularity)) {
    byBucket.set(start, 0);
  }
  for (const d of docs) {
    const key = bucketStartMs(d.uploadedMs, range.granularity);
    byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
  }
  const buckets: CountBucket[] = [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({ start: new Date(start).toISOString(), count }));

  // Whole-day upload→decision turnaround, for docs received in range that have
  // been reviewed. Never negative (clock skew guard), like time-to-paid.
  const reviewDays = docs
    .filter((d) => d.reviewedMs != null)
    .map((d) => Math.max(0, Math.round(((d.reviewedMs as number) - d.uploadedMs) / DAY_MS)));

  // Clients ranked by documents received in range. No-client uploads still
  // count in the total but can't be ranked. Pure so it's unit-tested directly.
  const byClient = new Map<string, number>();
  for (const d of docs) {
    if (!d.clientId) continue;
    byClient.set(d.clientId, (byClient.get(d.clientId) ?? 0) + 1);
  }
  const topClients: TopDocClient[] = [...byClient.entries()]
    .map(([id, count]) => ({ name: clientNames.get(id) ?? "", count }))
    .filter((c) => c.name !== "")
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_CLIENTS_LIMIT);

  const months = monthsCovered(fromMs, range.endMs);
  return {
    totalReceived,
    buckets,
    granularity: range.granularity,
    perMonthAvg: totalReceived / months,
    monthsCovered: months,
    pendingReview,
    timeToReview: {
      avgDays: reviewDays.length ? (avg(reviewDays) as number) : null,
      count: reviewDays.length,
    },
    topClients,
  };
}

// ── Money ─────────────────────────────────────────────────────────────────────

export type PaidInvoice = {
  amountCents: number;
  paidAtMs: number;
  createdAtMs: number;
  locksDeliverables: boolean;
  clientId: string | null;
};

// Rank clients by total paid in range (most first), resolving names from the
// provided map. Invoices with no client are excluded from the ranking (they
// still count in the collected total). Pure so it's unit-tested directly.
function rankTopClients(
  paid: PaidInvoice[],
  clientNames: Map<string, string>,
): TopClient[] {
  const byClient = new Map<string, { cents: number; count: number }>();
  for (const p of paid) {
    if (!p.clientId) continue;
    const cur = byClient.get(p.clientId) ?? { cents: 0, count: 0 };
    cur.cents += p.amountCents;
    cur.count += 1;
    byClient.set(p.clientId, cur);
  }
  return [...byClient.entries()]
    .map(([id, v]) => ({
      name: clientNames.get(id) ?? "",
      cents: v.cents,
      count: v.count,
    }))
    .filter((c) => c.name !== "")
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .slice(0, TOP_CLIENTS_LIMIT);
}

export type OutstandingInvoice = { amountCents: number };

export function aggregateMoney(
  paid: PaidInvoice[],
  outstanding: OutstandingInvoice[],
  range: ResolvedRange,
  currency: string,
  clientNames: Map<string, string> = new Map(),
): MoneySection {
  const collectedCents = paid.reduce((s, p) => s + p.amountCents, 0);
  const outstandingCents = outstanding.reduce((s, p) => s + p.amountCents, 0);

  // Enumerate the full span so empty periods render as zero. For all_time the
  // span starts at the earliest paid invoice (or now, if none were paid).
  const fromMs =
    range.startMs ??
    (paid.length ? Math.min(...paid.map((p) => p.paidAtMs)) : range.endMs);
  const byBucket = new Map<number, number>();
  for (const start of enumerateBuckets(fromMs, range.endMs, range.granularity)) {
    byBucket.set(start, 0);
  }
  for (const p of paid) {
    const key = bucketStartMs(p.paidAtMs, range.granularity);
    byBucket.set(key, (byBucket.get(key) ?? 0) + p.amountCents);
  }
  const buckets: MoneyBucket[] = [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, cents]) => ({ start: new Date(start).toISOString(), cents }));

  // Whole-day time-to-paid (created/sent → paid), never negative.
  const days = (p: PaidInvoice) =>
    Math.max(0, Math.round((p.paidAtMs - p.createdAtMs) / DAY_MS));
  const lockedDays = paid.filter((p) => p.locksDeliverables).map(days);
  const unlockedDays = paid.filter((p) => !p.locksDeliverables).map(days);
  const showSplit =
    lockedDays.length >= LOCK_SPLIT_MIN_SAMPLE &&
    unlockedDays.length >= LOCK_SPLIT_MIN_SAMPLE;

  return {
    currency,
    collectedCents,
    collectedCount: paid.length,
    outstandingCents,
    outstandingCount: outstanding.length,
    buckets,
    granularity: range.granularity,
    timeToPaid: {
      avgDays: avg(paid.map(days)),
      count: paid.length,
      split: showSplit
        ? {
            lockedAvgDays: avg(lockedDays) as number,
            lockedCount: lockedDays.length,
            unlockedAvgDays: avg(unlockedDays) as number,
            unlockedCount: unlockedDays.length,
          }
        : null,
    },
    topClients: rankTopClients(paid, clientNames),
  };
}
