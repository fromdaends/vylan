import { describe, it, expect } from "vitest";
import {
  avgHoursByService,
  avgRevenuePerHourCents,
  buildClientStats,
  clientsInRed,
  entryCostCents,
  firmTotals,
  GENERAL_SERVICE,
  hoursByMember,
  hoursByService,
  marginCents,
  membersWithoutRates,
  monthKey,
  monthlySeries,
  quadrant,
  rangeStart,
  rankHighestRevenue,
  rankLowestMargin,
  rankMostHours,
  toInsightsRange,
  UNATTRIBUTED,
  type InsightsEntry,
  type PaidRow,
} from "./metrics";

const TZ = "America/Toronto";

const entry = (over: Partial<InsightsEntry> = {}): InsightsEntry => ({
  id: over.id ?? "e1",
  userId: over.userId ?? "u1",
  clientId: over.clientId ?? "c1",
  engagementId: over.engagementId ?? null,
  startedAt: over.startedAt ?? "2026-08-06T16:00:00.000Z",
  durationMinutes: over.durationMinutes ?? 60,
});

const paid = (over: Partial<PaidRow> = {}): PaidRow => ({
  // `in` rather than ??, because clientId: null is a REAL value here (an
  // unattributed payment) and ?? would silently resurrect the default.
  clientId: "clientId" in over ? (over.clientId ?? null) : "c1",
  paidAt: over.paidAt ?? "2026-08-06T16:00:00.000Z",
  amountCents: over.amountCents ?? 10_000,
});

describe("range plumbing", () => {
  it("defaults unknown ranges to this_year", () => {
    expect(toInsightsRange("nonsense")).toBe("this_year");
    expect(toInsightsRange("all_time")).toBe("all_time");
  });

  it("anchors this_year to the FIRM's Jan 1, not UTC's", () => {
    // 01:00 UTC on Jan 1 is still Dec 31 evening in Quebec — the firm's year
    // has not started yet, so the range must open at the firm's Jan 1.
    const start = rangeStart("this_year", TZ, new Date("2026-01-01T01:00:00Z"));
    // Firm-local "today" is 2025-12-31 → this year = 2025.
    expect(start!.toISOString().slice(0, 4)).toBe("2025");
  });

  it("all_time has no start", () => {
    expect(rangeStart("all_time", TZ, new Date())).toBeNull();
  });

  it("last_12_months opens at the first of the month, 11 months back", () => {
    const start = rangeStart(
      "last_12_months",
      TZ,
      new Date("2026-08-06T16:00:00Z"),
    );
    expect(monthKey(start!.toISOString(), TZ)).toBe("2025-09");
  });
});

describe("cost math", () => {
  it("computes an entry's cost in integer cents", () => {
    expect(entryCostCents(90, 85.5)).toBe(12825); // 1.5h × $85.50
  });

  it("null snapshot means null, never zero", () => {
    expect(entryCostCents(90, null)).toBeNull();
    expect(entryCostCents(90, undefined)).toBeNull();
  });

  it("splits costed from uncosted minutes instead of mixing them", () => {
    const stats = buildClientStats(
      [
        entry({ id: "a", durationMinutes: 60 }),
        entry({ id: "b", durationMinutes: 30 }),
      ],
      new Map([["a", 100]]),
      [],
    );
    const c1 = stats.get("c1")!;
    expect(c1.minutes).toBe(90);
    expect(c1.costCents).toBe(10_000);
    expect(c1.uncostedMinutes).toBe(30);
  });
});

describe("client stats and firm totals", () => {
  it("firm totals are sums of the same primitives", () => {
    const stats = buildClientStats(
      [
        entry({ id: "a", clientId: "c1", durationMinutes: 60 }),
        entry({ id: "b", clientId: "c2", durationMinutes: 120 }),
      ],
      new Map([
        ["a", 100],
        ["b", 50],
      ]),
      [
        paid({ clientId: "c1", amountCents: 50_000 }),
        paid({ clientId: "c2", amountCents: 20_000 }),
      ],
    );
    const totals = firmTotals(stats);
    expect(totals.revenueCents).toBe(70_000);
    expect(totals.costCents).toBe(10_000 + 10_000);
    expect(totals.marginCents).toBe(totals.revenueCents - totals.costCents);
    expect(totals.minutes).toBe(180);
  });

  it("keeps unattributed payments in totals but off client rows", () => {
    const stats = buildClientStats([], new Map(), [
      paid({ clientId: null, amountCents: 12_345 }),
    ]);
    expect(firmTotals(stats).revenueCents).toBe(12_345);
    expect(stats.has(UNATTRIBUTED)).toBe(true);
    expect(rankHighestRevenue(stats)).toHaveLength(0);
    expect(quadrant(stats).points).toHaveLength(0);
  });

  it("margin is revenue minus labor cost", () => {
    expect(marginCents({ revenueCents: 50_000, costCents: 60_000 })).toBe(
      -10_000,
    );
  });
});

describe("average revenue per hour", () => {
  it("answers n/a under 10 logged hours", () => {
    expect(avgRevenuePerHourCents(400_000, 599)).toBeNull();
    expect(avgRevenuePerHourCents(400_000, 600)).toBe(40_000);
  });
});

describe("monthlySeries", () => {
  it("zero-fills quiet months so gaps are visible zeros", () => {
    const points = monthlySeries(
      [
        paid({ paidAt: "2026-05-15T12:00:00Z", amountCents: 100 }),
        paid({ paidAt: "2026-08-01T12:00:00Z", amountCents: 300 }),
      ],
      [],
      new Map(),
      TZ,
      rangeStart("this_year", TZ, new Date("2026-08-06T16:00:00Z")),
      new Date("2026-08-06T16:00:00Z"),
    );
    expect(points[0]!.month).toBe("2026-01");
    expect(points).toHaveLength(8); // Jan..Aug
    expect(points.find((p) => p.month === "2026-06")!.revenueCents).toBe(0);
    expect(points.find((p) => p.month === "2026-05")!.revenueCents).toBe(100);
  });

  it("buckets an entry's cost by the FIRM's month at UTC month boundaries", () => {
    // 01:30 UTC Aug 1 is still July 31 in Quebec.
    const points = monthlySeries(
      [],
      [entry({ id: "a", startedAt: "2026-08-01T01:30:00Z", durationMinutes: 60 })],
      new Map([["a", 100]]),
      TZ,
      rangeStart("this_year", TZ, new Date("2026-08-06T16:00:00Z")),
      new Date("2026-08-06T16:00:00Z"),
    );
    expect(points.find((p) => p.month === "2026-07")!.costCents).toBe(10_000);
    expect(points.find((p) => p.month === "2026-08")!.costCents).toBe(0);
  });
});

describe("quadrant", () => {
  it("excludes zero-hour clients from the scatter but not the tables", () => {
    const stats = buildClientStats(
      [entry({ id: "a", clientId: "c1", durationMinutes: 120 })],
      new Map(),
      [
        paid({ clientId: "c1", amountCents: 10_000 }),
        paid({ clientId: "c2", amountCents: 99_000 }),
      ],
    );
    const q = quadrant(stats);
    expect(q.points.map((p) => p.clientId)).toEqual(["c1"]);
    const rev = rankHighestRevenue(stats);
    expect(rev[0]!.clientId).toBe("c2");
    expect(rev[0]!.zeroHours).toBe(true);
  });

  it("computes medians of each axis", () => {
    const stats = buildClientStats(
      [
        entry({ id: "a", clientId: "c1", durationMinutes: 60 }),
        entry({ id: "b", clientId: "c2", durationMinutes: 180 }),
        entry({ id: "c", clientId: "c3", durationMinutes: 600 }),
      ],
      new Map(),
      [],
    );
    expect(quadrant(stats).medianHours).toBe(3);
  });
});

describe("rankings", () => {
  it("clients in the red are negative-margin only, worst first", () => {
    const stats = buildClientStats(
      [
        entry({ id: "a", clientId: "c1", durationMinutes: 600 }),
        entry({ id: "b", clientId: "c2", durationMinutes: 60 }),
      ],
      new Map([
        ["a", 100], // c1 cost $1000
        ["b", 100], // c2 cost $100
      ]),
      [
        paid({ clientId: "c1", amountCents: 20_000 }), // c1 margin -$800
        paid({ clientId: "c2", amountCents: 50_000 }), // c2 margin +$400
      ],
    );
    const red = clientsInRed(stats);
    expect(red.map((r) => r.clientId)).toEqual(["c1"]);
  });

  it("lowest margin ranks worst first and includes zero-hour clients", () => {
    const stats = buildClientStats(
      [entry({ id: "a", clientId: "c1", durationMinutes: 600 })],
      new Map([["a", 200]]),
      [paid({ clientId: "c2", amountCents: 5_000 })],
    );
    const low = rankLowestMargin(stats);
    expect(low[0]!.clientId).toBe("c1"); // -$2000
    expect(low[1]!.clientId).toBe("c2"); // +$50
  });

  it("most hours ignores clients with none", () => {
    const stats = buildClientStats(
      [entry({ id: "a", clientId: "c1" })],
      new Map(),
      [paid({ clientId: "c2" })],
    );
    expect(rankMostHours(stats).map((r) => r.clientId)).toEqual(["c1"]);
  });
});

describe("team", () => {
  it("sums hours per member, busiest first", () => {
    const hours = hoursByMember([
      entry({ id: "a", userId: "u1", durationMinutes: 30 }),
      entry({ id: "b", userId: "u2", durationMinutes: 90 }),
      entry({ id: "c", userId: "u1", durationMinutes: 15 }),
    ]);
    expect(hours).toEqual([
      { userId: "u2", minutes: 90 },
      { userId: "u1", minutes: 45 },
    ]);
  });

  it("groups service hours by the engagement's headline service, else General", () => {
    const hours = hoursByService(
      [
        entry({ id: "a", engagementId: "g1", durationMinutes: 60 }),
        entry({ id: "b", engagementId: "g2", durationMinutes: 30 }),
        entry({ id: "c", engagementId: null, durationMinutes: 10 }),
      ],
      new Map([["g1", "Monthly bookkeeping"]]),
    );
    expect(hours).toEqual([
      { service: "Monthly bookkeeping", minutes: 60 },
      { service: GENERAL_SERVICE, minutes: 40 },
    ]);
  });

  it("averages hours over COMPLETED engagements only", () => {
    const avg = avgHoursByService(
      [
        entry({ id: "a", engagementId: "g1", durationMinutes: 120 }),
        entry({ id: "b", engagementId: "g2", durationMinutes: 60 }),
        entry({ id: "c", engagementId: "g3", durationMinutes: 999 }), // not completed
      ],
      new Set(["g1", "g2"]),
      new Map([
        ["g1", "T2"],
        ["g2", "T2"],
      ]),
    );
    expect(avg).toEqual([{ service: "T2", count: 2, avgMinutes: 90 }]);
  });
});

describe("membersWithoutRates", () => {
  it("uses live rates when readable", () => {
    const out = membersWithoutRates(
      [entry({ id: "a", userId: "u1" }), entry({ id: "b", userId: "u2" })],
      new Map(),
      new Set(["u1"]),
    );
    expect(out).toEqual(["u2"]);
  });

  it("falls back to snapshots when live rates are not readable", () => {
    const out = membersWithoutRates(
      [entry({ id: "a", userId: "u1" }), entry({ id: "b", userId: "u2" })],
      new Map([["a", 100]]),
      null,
    );
    expect(out).toEqual(["u2"]);
  });
});
