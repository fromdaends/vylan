// The Insights loader — fetch once, compute in metrics.ts, ship AGGREGATES.
//
// This is the ONE module allowed to see both sides of the hours/money split:
// it reads time entries (the shared hours) AND time_entry_costs (the gated
// dollars) and joins them in server memory. What leaves this module is the
// computed payload the page renders — never entry-level rate data, per the
// build spec: "ship computed aggregates plus rate-free entry lists".
//
// EVERY read here runs as the CALLER through RLS:
//   * time_entry_costs answers [] for anyone without insights.view — so even
//     if a page forgot its guard, the margins would all be "no cost data",
//     not someone else's payroll.
//   * listPaidInvoices reads the same rows the billing surfaces read, RPC
//     "count but don't name" included.
//   * user_rates answers [] for non-rates.manage holders; the missing-rate
//     banner then falls back to snapshot evidence (metrics.membersWithoutRates).

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { listPaidInvoices } from "@/lib/performance/money";
import { listEntriesForInsights } from "@/lib/db/time-entries";
import { listUserRates } from "@/lib/db/user-rates";
import { listClients } from "@/lib/db/clients";
import { listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import {
  listEngagements,
  listItemNamesByEngagement,
} from "@/lib/db/engagements";
import { PLANS, type PlanId } from "@/lib/plans";
import type { Firm } from "@/lib/db/firms";
import {
  avgHoursByService,
  avgRevenuePerHourCents,
  buildClientStats,
  clientsInRed,
  firmTotals,
  hoursByMember,
  hoursByService,
  membersWithoutRates,
  monthlySeries,
  quadrant,
  rangeStart,
  rankHighestRevenue,
  rankLowestMargin,
  rankMostHours,
  type InsightsEntry,
  type InsightsRange,
  type MonthPoint,
} from "./metrics";

export type ClientRow = {
  clientId: string;
  name: string;
  minutes: number;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  uncostedMinutes: number;
  zeroHours: boolean;
};

export type InsightsPayload = {
  range: InsightsRange;
  totals: {
    revenueCents: number;
    minutes: number;
    marginCents: number;
    costCents: number;
    avgRevenuePerHourCents: number | null;
    uncostedMinutes: number;
  };
  months: MonthPoint[];
  /** The firm's Vylan subscription per month, for the optional
   *  "after Vylan subscription" toggle. Firm-level ONLY — never allocated per
   *  client (spec rule). */
  subscriptionCentsPerMonth: number;
  quadrant: {
    points: {
      clientId: string;
      name: string;
      hours: number;
      revenueCents: number;
      marginCents: number;
    }[];
    medianHours: number;
    medianRevenueCents: number;
  };
  mostHours: ClientRow[];
  highestRevenue: ClientRow[];
  lowestMargin: ClientRow[];
  inRed: ClientRow[];
  team: {
    byMember: { userId: string; name: string; minutes: number }[];
    byService: { service: string | null; minutes: number }[];
    avgByService: { service: string | null; count: number; avgMinutes: number }[];
  };
  missingRates: { userId: string; name: string }[];
  hasEntries: boolean;
  hasPayments: boolean;
};

/** time_entry_costs, as the caller. A map of entry id → rate snapshot. */
async function loadCostSnapshots(): Promise<Map<string, number>> {
  const supabase = await getServerSupabase();
  const out = new Map<string, number>();
  const PAGE = 1000;
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const { data, error } = await supabase
      .from("time_entry_costs")
      .select("time_entry_id, cost_rate_snapshot")
      .order("time_entry_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      if (!isMissingSchema(error)) {
        console.error("[insights] cost snapshots failed:", error);
      }
      return out;
    }
    const rows = (data ?? []) as {
      time_entry_id: string;
      cost_rate_snapshot: number | string;
    }[];
    for (const r of rows) out.set(r.time_entry_id, Number(r.cost_rate_snapshot));
    if (rows.length < PAGE) break;
  }
  return out;
}

const GENERAL: string | null = null;

export async function loadInsights(
  firm: Firm,
  range: InsightsRange,
  now: Date = new Date(),
): Promise<InsightsPayload> {
  const start = rangeStart(range, firm.timezone, now);
  const startIso = start ? start.toISOString() : null;

  const [entriesRaw, costByEntryId, paid, clients, users, engagements, serviceNames, rates] =
    await Promise.all([
      listEntriesForInsights(startIso),
      loadCostSnapshots(),
      listPaidInvoices(startIso),
      // Archived included: an archived client's history is still history, and
      // a margin table with blank names answers nothing.
      listClients({ includeArchived: true }),
      listFirmUsers(),
      // "any" lifecycle + all statuses: an archived-but-completed job is still
      // part of "how long does a T2 actually take", which is the question the
      // avg-hours table answers.
      listEngagements({ status: "all", scope: "any" }),
      listItemNamesByEngagement(),
      // [] for viewers without rates.manage — the banner then falls back to
      // snapshot evidence.
      listUserRates(),
    ]);

  const entries: InsightsEntry[] = entriesRaw.map((e) => ({
    id: e.id,
    userId: e.user_id,
    clientId: e.client_id,
    engagementId: e.engagement_id,
    startedAt: e.started_at,
    durationMinutes: e.duration_minutes,
  }));

  const clientName = new Map(clients.map((c) => [c.id, c.display_name]));
  const memberName = new Map(users.map((u) => [u.id, userDisplayLabel(u)]));
  const serviceByEngagement = new Map<string, string>();
  for (const [engId, names] of serviceNames) {
    if (names[0]) serviceByEngagement.set(engId, names[0]);
  }
  const completedIds = new Set(
    engagements.filter((e) => e.status === "complete").map((e) => e.id),
  );

  const stats = buildClientStats(entries, costByEntryId, paid);
  const totals = firmTotals(stats);
  const q = quadrant(stats);

  const toRow = (s: {
    clientId: string;
    minutes: number;
    revenueCents: number;
    costCents: number;
    marginCents: number;
    uncostedMinutes: number;
    zeroHours: boolean;
  }): ClientRow => ({
    ...s,
    name: clientName.get(s.clientId) ?? "—",
  });

  const liveRated =
    rates.length > 0
      ? new Set(
          rates
            .filter((r) => r.cost_rate_hourly != null)
            .map((r) => r.user_id),
        )
      : null;

  const planId: PlanId = (firm.plan in PLANS ? firm.plan : "trial") as PlanId;

  return {
    range,
    totals: {
      revenueCents: totals.revenueCents,
      minutes: totals.minutes,
      marginCents: totals.marginCents,
      costCents: totals.costCents,
      avgRevenuePerHourCents: avgRevenuePerHourCents(
        totals.revenueCents,
        totals.minutes,
      ),
      uncostedMinutes: totals.uncostedMinutes,
    },
    months: monthlySeries(paid, entries, costByEntryId, firm.timezone, start, now),
    subscriptionCentsPerMonth: PLANS[planId].monthlyCadCents ?? 0,
    quadrant: {
      points: q.points.map((p) => ({
        ...p,
        name: clientName.get(p.clientId) ?? "—",
      })),
      medianHours: q.medianHours,
      medianRevenueCents: q.medianRevenueCents,
    },
    mostHours: rankMostHours(stats).map(toRow),
    highestRevenue: rankHighestRevenue(stats).map(toRow),
    lowestMargin: rankLowestMargin(stats).map(toRow),
    inRed: clientsInRed(stats).map(toRow),
    team: {
      byMember: hoursByMember(entries).map((h) => ({
        ...h,
        name: memberName.get(h.userId) ?? "—",
      })),
      byService: hoursByService(entries, serviceByEngagement).map((h) => ({
        service: h.service === "__general__" ? GENERAL : h.service,
        minutes: h.minutes,
      })),
      avgByService: avgHoursByService(
        entries,
        completedIds,
        serviceByEngagement,
      ).map((a) => ({
        service: a.service === "__general__" ? GENERAL : a.service,
        count: a.count,
        avgMinutes: a.avgMinutes,
      })),
    },
    missingRates: membersWithoutRates(entries, costByEntryId, liveRated).map(
      (userId) => ({ userId, name: memberName.get(userId) ?? "—" }),
    ),
    hasEntries: entries.length > 0,
    hasPayments: paid.length > 0,
  };
}
