// Range resolution + calendar bucketing for the Performance page.
//
// Vylan's market is Quebec, so range boundaries ("this month", "last 3 months")
// are computed in EASTERN civil time, not UTC. That matters at the edges: a
// payment at 11pm Eastern on the last day of a month must land in that month,
// not spill into the next one. The database stores UTC timestamps (timestamptz);
// these helpers translate Eastern civil dates to the UTC instants we filter on.
//
// No timezone dependency: we derive the Eastern offset from Intl, which knows
// the DST rules, and correct across DST transitions with a second pass.

import type { MoneyBucketGranularity, PerformanceRange } from "./types";

export const PERFORMANCE_TZ = "America/Toronto";

export type ResolvedRange = {
  range: PerformanceRange;
  // Lower bound as a UTC instant (ms). null = no lower bound ("all time").
  startMs: number | null;
  // Upper bound as a UTC instant (ms) — always "now".
  endMs: number;
  // ISO strings for Supabase filters (startIso null when all_time).
  startIso: string | null;
  endIso: string;
  granularity: MoneyBucketGranularity;
};

// The offset (minutes east of UTC; Eastern is negative) that `timeZone` was at
// the given UTC instant.
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return (asUtc - utcMs) / 60000;
}

// Convert an Eastern civil datetime (mo is 1-12; d/h roll over via Date.UTC) to
// a UTC instant in ms. Two-pass so it stays correct across DST transitions.
export function easternCivilToUtcMs(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
): number {
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffsetMinutes(naiveUtc, PERFORMANCE_TZ);
  const utc1 = naiveUtc - off1 * 60000;
  const off2 = tzOffsetMinutes(utc1, PERFORMANCE_TZ);
  return off2 === off1 ? utc1 : naiveUtc - off2 * 60000;
}

// The Eastern civil year/month/day for a given UTC instant.
export function easternYmd(utcMs: number): {
  y: number;
  mo: number;
  d: number;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PERFORMANCE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return { y: Number(map.year), mo: Number(map.month), d: Number(map.day) };
}

function monthsBack(y: number, mo: number, n: number): { y: number; mo: number } {
  const idx = y * 12 + (mo - 1) - n;
  return { y: Math.floor(idx / 12), mo: (idx % 12) + 1 };
}

// Resolve one of the three ranges into concrete query bounds + a bucket
// granularity. Takes `nowMs` explicitly so it is pure and testable.
export function resolveRange(
  range: PerformanceRange,
  nowMs: number,
): ResolvedRange {
  const endMs = nowMs;
  const { y, mo } = easternYmd(nowMs);
  let startMs: number | null;
  let granularity: MoneyBucketGranularity;

  if (range === "this_month") {
    startMs = easternCivilToUtcMs(y, mo, 1);
    granularity = "day";
  } else if (range === "last_3_months") {
    // The current month plus the two before it → three monthly buckets.
    const start = monthsBack(y, mo, 2);
    startMs = easternCivilToUtcMs(start.y, start.mo, 1);
    granularity = "month";
  } else {
    startMs = null;
    granularity = "month";
  }

  return {
    range,
    startMs,
    endMs,
    startIso: startMs == null ? null : new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    granularity,
  };
}

// The UTC instant of the start of the Eastern day/month containing utcMs.
export function bucketStartMs(
  utcMs: number,
  granularity: MoneyBucketGranularity,
): number {
  const { y, mo, d } = easternYmd(utcMs);
  return granularity === "day"
    ? easternCivilToUtcMs(y, mo, d)
    : easternCivilToUtcMs(y, mo, 1);
}

// Enumerate every bucket-start instant covering [fromMs, toMs] at the given
// granularity, so empty periods render as zero rather than collapsing the chart.
export function enumerateBuckets(
  fromMs: number,
  toMs: number,
  granularity: MoneyBucketGranularity,
): number[] {
  const out: number[] = [];
  let cur = bucketStartMs(fromMs, granularity);
  // Guard against a pathological span (e.g. a bad clock) running away.
  let guard = 0;
  while (cur <= toMs && guard++ < 5000) {
    out.push(cur);
    const { y, mo, d } = easternYmd(cur);
    cur =
      granularity === "day"
        ? easternCivilToUtcMs(y, mo, d + 1)
        : easternCivilToUtcMs(y, mo + 1, 1);
  }
  return out;
}
