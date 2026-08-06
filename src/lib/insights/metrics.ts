// The numbers behind Insights — PURE, so they can be argued with.
//
// Same contract as lib/dashboard/work-metrics.ts, and for the same reason:
// when a margin looks wrong there is no vendor to ask, so every figure on the
// Insights page comes out of a function in this file with a test beside it.
// The loader (load.ts) fetches rows; nothing in here touches a database, a
// Date.now(), or a component.
//
// ── THE MATH DEFINITIONS (single source of truth, per the build spec) ──────
//
//   REVENUE for a client/range  = sum of payments COLLECTED in range
//                                 attributed to that client. Partial payments
//                                 count when collected.
//   LABOR COST for a client     = Σ (duration_minutes / 60) × cost_rate_snapshot
//                                 over that client's entries in range,
//                                 SKIPPING entries with no snapshot — unknown
//                                 cost is excluded, never counted as free.
//   ESTIMATED MARGIN            = revenue − labor cost.
//   FIRM TOTALS                 = sums of the same primitives, never a second
//                                 query with different logic.
//
// Money stays in INTEGER CENTS end to end (the lib/invoices/totals.ts rule:
// never let a float reach state); the one multiplication by an hourly rate
// rounds once, per entry.
//
// ── EVERY DATE DECISION IS THE FIRM'S TIMEZONE ─────────────────────────────
// The server renders in UTC, where a Quebec evening is already tomorrow.
// Callers pass the firm timezone; month bucketing goes through the same
// Intl path as lib/tasks/dates.ts.

import { dateInTimeZone } from "@/lib/tasks/dates";
import { noonInTimeZone } from "@/lib/time/dates";

export type InsightsRange = "this_year" | "last_12_months" | "all_time";

export const INSIGHTS_RANGES: InsightsRange[] = [
  "this_year",
  "last_12_months",
  "all_time",
];

export function toInsightsRange(v: unknown): InsightsRange {
  return v === "last_12_months" || v === "all_time" ? v : "this_year";
}

/** The instant the range opens, or null for all time. Anchored to the FIRM's
 *  calendar: "this year" starts at the firm's Jan 1, not UTC's. */
export function rangeStart(
  range: InsightsRange,
  timeZone: string,
  now: Date,
): Date | null {
  if (range === "all_time") return null;
  const today = dateInTimeZone(now.toISOString(), timeZone) ?? "";
  if (range === "this_year") {
    const jan1noon = noonInTimeZone(`${today.slice(0, 4)}-01-01`, timeZone);
    return jan1noon ? new Date(jan1noon.getTime() - 12 * 3_600_000) : null;
  }
  // last_12_months: from the first day of the month 11 months back — twelve
  // whole month buckets ending in the current one.
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const startMonth = m - 11;
  const sy = startMonth >= 1 ? y : y - 1;
  const sm = startMonth >= 1 ? startMonth : startMonth + 12;
  const noon = noonInTimeZone(
    `${sy}-${String(sm).padStart(2, "0")}-01`,
    timeZone,
  );
  return noon ? new Date(noon.getTime() - 12 * 3_600_000) : null;
}

export type InsightsEntry = {
  id: string;
  userId: string;
  clientId: string;
  engagementId: string | null;
  startedAt: string;
  durationMinutes: number;
};

export type PaidRow = {
  clientId: string | null;
  paidAt: string;
  amountCents: number;
};

/** "2026-08" in the firm's calendar. */
export function monthKey(iso: string, timeZone: string): string {
  return (dateInTimeZone(iso, timeZone) ?? iso.slice(0, 10)).slice(0, 7);
}

/** Labor cost of ONE entry in cents, or null when it carries no snapshot. */
export function entryCostCents(
  durationMinutes: number,
  rateSnapshot: number | null | undefined,
): number | null {
  if (rateSnapshot == null) return null;
  return Math.round((durationMinutes / 60) * rateSnapshot * 100);
}

export type ClientStat = {
  clientId: string;
  minutes: number;
  /** Only snapshot-carrying entries. */
  costCents: number;
  /** Minutes that carry NO snapshot — surfaced, not silently mixed in. */
  uncostedMinutes: number;
  revenueCents: number;
};

/** The one aggregation everything else reads. Firm totals are sums over this
 *  map — deliberately no separate firm-level query path. */
export function buildClientStats(
  entries: InsightsEntry[],
  costByEntryId: ReadonlyMap<string, number>,
  paid: PaidRow[],
): Map<string, ClientStat> {
  const stats = new Map<string, ClientStat>();
  const get = (clientId: string): ClientStat => {
    let s = stats.get(clientId);
    if (!s) {
      s = {
        clientId,
        minutes: 0,
        costCents: 0,
        uncostedMinutes: 0,
        revenueCents: 0,
      };
      stats.set(clientId, s);
    }
    return s;
  };
  for (const e of entries) {
    const s = get(e.clientId);
    s.minutes += e.durationMinutes;
    const cost = entryCostCents(e.durationMinutes, costByEntryId.get(e.id));
    if (cost == null) s.uncostedMinutes += e.durationMinutes;
    else s.costCents += cost;
  }
  for (const p of paid) {
    // Payments with no client attribution count in firm totals but cannot sit
    // on a client row; they are carried under a reserved key.
    const s = get(p.clientId ?? UNATTRIBUTED);
    s.revenueCents += p.amountCents;
  }
  return stats;
}

/** Reserved key for collected money with no client link. Never rendered as a
 *  client; always included in firm totals. */
export const UNATTRIBUTED = "__unattributed__";

export function marginCents(s: Pick<ClientStat, "revenueCents" | "costCents">): number {
  return s.revenueCents - s.costCents;
}

export type FirmTotals = {
  revenueCents: number;
  costCents: number;
  marginCents: number;
  minutes: number;
  uncostedMinutes: number;
};

export function firmTotals(stats: ReadonlyMap<string, ClientStat>): FirmTotals {
  let revenueCents = 0;
  let costCents = 0;
  let minutes = 0;
  let uncostedMinutes = 0;
  for (const s of stats.values()) {
    revenueCents += s.revenueCents;
    costCents += s.costCents;
    minutes += s.minutes;
    uncostedMinutes += s.uncostedMinutes;
  }
  return {
    revenueCents,
    costCents,
    marginCents: revenueCents - costCents,
    minutes,
    uncostedMinutes,
  };
}

/** Revenue ÷ hours, in cents — null under 10 logged hours, because $4,000
 *  over 12 minutes is a silly number, not an insight. */
export function avgRevenuePerHourCents(
  revenueCents: number,
  minutes: number,
): number | null {
  if (minutes < 600) return null;
  return Math.round(revenueCents / (minutes / 60));
}

export type MonthPoint = {
  month: string; // "2026-08"
  revenueCents: number;
  costCents: number;
};

/** One point per month from the range start (or the earliest data) to now,
 *  zero-filled so a quiet month is a visible zero rather than a gap. */
export function monthlySeries(
  paid: PaidRow[],
  entries: InsightsEntry[],
  costByEntryId: ReadonlyMap<string, number>,
  timeZone: string,
  start: Date | null,
  now: Date,
): MonthPoint[] {
  const revenue = new Map<string, number>();
  const cost = new Map<string, number>();
  for (const p of paid) {
    const k = monthKey(p.paidAt, timeZone);
    revenue.set(k, (revenue.get(k) ?? 0) + p.amountCents);
  }
  for (const e of entries) {
    const c = entryCostCents(e.durationMinutes, costByEntryId.get(e.id));
    if (c == null) continue;
    const k = monthKey(e.startedAt, timeZone);
    cost.set(k, (cost.get(k) ?? 0) + c);
  }
  const keys = [...new Set([...revenue.keys(), ...cost.keys()])].sort();
  const firstKey = start
    ? monthKey(start.toISOString(), timeZone)
    : keys[0] ?? monthKey(now.toISOString(), timeZone);
  const lastKey = monthKey(now.toISOString(), timeZone);
  const out: MonthPoint[] = [];
  let [y, m] = [Number(firstKey.slice(0, 4)), Number(firstKey.slice(5, 7))];
  // Zero-fill month by month; hard cap well above "all time" for any real firm
  // so malformed input can never loop forever.
  for (let i = 0; i < 240; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push({
      month: k,
      revenueCents: revenue.get(k) ?? 0,
      costCents: cost.get(k) ?? 0,
    });
    if (k >= lastKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ── Clients tab ────────────────────────────────────────────────────────────

export type QuadrantPoint = {
  clientId: string;
  hours: number;
  revenueCents: number;
  marginCents: number;
};

export type Quadrant = {
  points: QuadrantPoint[];
  medianHours: number;
  medianRevenueCents: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Hours consumed vs revenue collected, one dot per client. Clients with
 *  revenue but ZERO logged hours are excluded here (they still appear in the
 *  ranked tables with a marker) — a dot pinned to the axis is noise. */
export function quadrant(stats: ReadonlyMap<string, ClientStat>): Quadrant {
  const points: QuadrantPoint[] = [];
  for (const s of stats.values()) {
    if (s.clientId === UNATTRIBUTED) continue;
    if (s.minutes <= 0) continue;
    points.push({
      clientId: s.clientId,
      hours: Math.round((s.minutes / 60) * 10) / 10,
      revenueCents: s.revenueCents,
      marginCents: marginCents(s),
    });
  }
  return {
    points,
    medianHours: median(points.map((p) => p.hours)),
    medianRevenueCents: median(points.map((p) => p.revenueCents)),
  };
}

export type RankedClient = ClientStat & {
  marginCents: number;
  zeroHours: boolean;
};

function ranked(stats: ReadonlyMap<string, ClientStat>): RankedClient[] {
  return [...stats.values()]
    .filter((s) => s.clientId !== UNATTRIBUTED)
    .map((s) => ({ ...s, marginCents: marginCents(s), zeroHours: s.minutes === 0 }));
}

export function rankMostHours(stats: ReadonlyMap<string, ClientStat>): RankedClient[] {
  return ranked(stats)
    .filter((s) => s.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

export function rankHighestRevenue(stats: ReadonlyMap<string, ClientStat>): RankedClient[] {
  return ranked(stats)
    .filter((s) => s.revenueCents > 0)
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

/** Lowest estimated margin first. Only clients with any activity at all —
 *  a client with no revenue and no hours has no margin to rank. */
export function rankLowestMargin(stats: ReadonlyMap<string, ClientStat>): RankedClient[] {
  return ranked(stats)
    .filter((s) => s.revenueCents > 0 || s.minutes > 0)
    .sort((a, b) => a.marginCents - b.marginCents);
}

/** Negative estimated margin in the range. Empty is the GOOD answer and the
 *  UI says so. */
export function clientsInRed(stats: ReadonlyMap<string, ClientStat>): RankedClient[] {
  return ranked(stats)
    .filter((s) => marginCents(s) < 0)
    .sort((a, b) => a.marginCents - b.marginCents);
}

// ── Team tab ───────────────────────────────────────────────────────────────

export type MemberHours = { userId: string; minutes: number };

export function hoursByMember(entries: InsightsEntry[]): MemberHours[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    map.set(e.userId, (map.get(e.userId) ?? 0) + e.durationMinutes);
  }
  return [...map.entries()]
    .map(([userId, minutes]) => ({ userId, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

export const GENERAL_SERVICE = "__general__";

/** Hours grouped by the SERVICE the engagement sells (its first priced line's
 *  name — the same "headline service" the engagements list prints). Entries
 *  with no engagement, or on an engagement with no priced lines, group under
 *  General. This follows the audit's finding that engagements.type is a dead
 *  label ("Custom" on six of ten real jobs) while engagement_items names are
 *  the live vocabulary. */
export function hoursByService(
  entries: InsightsEntry[],
  serviceByEngagement: ReadonlyMap<string, string>,
): { service: string; minutes: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const service =
      (e.engagementId ? serviceByEngagement.get(e.engagementId) : null) ??
      GENERAL_SERVICE;
    map.set(service, (map.get(service) ?? 0) + e.durationMinutes);
  }
  return [...map.entries()]
    .map(([service, minutes]) => ({ service, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** For COMPLETED engagements in range that have time entries: the average
 *  total hours, grouped by the same service vocabulary. Answers "what does a
 *  bookkeeping month actually cost us in hours". */
export function avgHoursByService(
  entries: InsightsEntry[],
  completedEngagementIds: ReadonlySet<string>,
  serviceByEngagement: ReadonlyMap<string, string>,
): { service: string; count: number; avgMinutes: number }[] {
  const perEngagement = new Map<string, number>();
  for (const e of entries) {
    if (!e.engagementId || !completedEngagementIds.has(e.engagementId)) continue;
    perEngagement.set(
      e.engagementId,
      (perEngagement.get(e.engagementId) ?? 0) + e.durationMinutes,
    );
  }
  const grouped = new Map<string, { count: number; total: number }>();
  for (const [engagementId, minutes] of perEngagement) {
    const service = serviceByEngagement.get(engagementId) ?? GENERAL_SERVICE;
    const g = grouped.get(service) ?? { count: 0, total: 0 };
    g.count += 1;
    g.total += minutes;
    grouped.set(service, g);
  }
  return [...grouped.entries()]
    .map(([service, g]) => ({
      service,
      count: g.count,
      avgMinutes: Math.round(g.total / g.count),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Who has hours in range but no cost rate anywhere — the missing-rate banner.
 *  liveRatedUserIds comes from user_rates when the viewer may read it
 *  (rates.manage); when they may not, pass null and the fallback counts a
 *  member as unrated only if NONE of their entries carries a snapshot. */
export function membersWithoutRates(
  entries: InsightsEntry[],
  costByEntryId: ReadonlyMap<string, number>,
  liveRatedUserIds: ReadonlySet<string> | null,
): string[] {
  const byUser = new Map<string, { any: boolean; snapshotted: boolean }>();
  for (const e of entries) {
    const u = byUser.get(e.userId) ?? { any: false, snapshotted: false };
    u.any = true;
    if (costByEntryId.has(e.id)) u.snapshotted = true;
    byUser.set(e.userId, u);
  }
  const out: string[] = [];
  for (const [userId, u] of byUser) {
    const unrated = liveRatedUserIds
      ? !liveRatedUserIds.has(userId)
      : !u.snapshotted;
    if (unrated) out.push(userId);
  }
  return out;
}
