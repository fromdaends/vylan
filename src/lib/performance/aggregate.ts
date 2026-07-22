// Pure aggregation for the Performance page. NO database, NO server imports —
// the loaders (ai.ts / money.ts) fetch rows and hand them here so this counting
// logic is unit-tested directly. Every number is a plain reduction over records.

import { scoreFile, type AiScorableFile } from "./ai-verdict";
import { bucketStartMs, enumerateBuckets, type ResolvedRange } from "./range";
import {
  AI_EARLY_DATA_THRESHOLD,
  LOCK_SPLIT_MIN_SAMPLE,
  TOP_CLIENTS_LIMIT,
  type AiSection,
  type FourCase,
  type MoneyBucket,
  type MoneySection,
  type TopClient,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

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

const avg = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

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
