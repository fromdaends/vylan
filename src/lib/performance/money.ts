// Money loader. Reads the firm's invoices (payment_requests) through the same
// RLS-scoped path the Settings > Payments history uses, so the totals can never
// drift from that list. Collected + time-to-paid + monthly buckets come from
// invoices PAID in range; Outstanding is a live snapshot of unpaid invoices.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  aggregateMoney,
  type OutstandingInvoice,
  type PaidInvoice,
} from "./aggregate";
import { resolveRange, type ResolvedRange } from "./range";
import type { MoneySection, PerformanceRange } from "./types";

const PAGE = 1000;
const MAX_ROWS = 50_000;

function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}

// The Wave-4 "count but don't name" RPCs (migration 0820) may not be applied to
// the remote DB yet. PostgREST reports an unknown function as PGRST202 (not in
// schema cache) / 42883 (undefined_function). When that happens we fall back to
// the RLS-scoped read below — which merely undercounts private clients for staff
// until 0820 lands, never a 500.
function isMissingFunction(err: { code?: string } | null): boolean {
  return err?.code === "PGRST202" || err?.code === "42883";
}

type PaidRow = {
  amount_cents: number;
  currency: string | null;
  created_at: string;
  paid_at: string | null;
  client_id: string | null;
  locks_deliverables?: boolean | null;
};

// Paid invoices, firm-wide INCLUDING private clients (so staff totals are
// complete — "count but don't name"). Tries the 0820 definer RPC first; on an
// un-migrated DB it falls back to the RLS-scoped read (which undercounts private
// clients for staff until 0820 is applied). The RPC redacts the private client's
// id for staff, so private invoices count in the totals but can't be named.
async function fetchPaid(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<PaidRow[]> {
  const { data, error } = await sb.rpc("perf_paid_invoices", {
    p_start: range.startIso ?? null,
  });
  if (!error) return (data ?? []) as unknown as PaidRow[];
  if (!isMissingFunction(error)) {
    console.error("[performance] perf_paid_invoices rpc failed:", error);
  }
  return fetchPaidViaRls(sb, range);
}

// Tiered select: try with locks_deliverables (migration 0610) and fall back to
// the legacy shape if that column is absent, treating those invoices as
// unlocked — so the money section still renders on an un-migrated environment.
async function fetchPaidViaRls(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<PaidRow[]> {
  const withLock =
    "amount_cents, currency, created_at, paid_at, client_id, locks_deliverables";
  const legacy = "amount_cents, currency, created_at, paid_at, client_id";
  let cols = withLock;
  const rows: PaidRow[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
    const run = () => {
      let q = sb
        .from("payment_requests")
        .select(cols)
        .eq("status", "paid")
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (range.startIso) q = q.gte("paid_at", range.startIso);
      return q;
    };
    let { data, error } = await run();
    if (error && isMissingColumn(error) && cols === withLock) {
      cols = legacy;
      ({ data, error } = await run());
    }
    if (error) {
      console.error("[performance] fetchPaid failed:", error);
      break;
    }
    const batch = (data ?? []) as unknown as PaidRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function fetchOutstanding(
  sb: SupabaseClient,
): Promise<{ amount_cents: number; currency: string | null }[]> {
  const { data, error } = await sb.rpc("perf_outstanding_invoices");
  if (!error) {
    return (data ?? []) as unknown as {
      amount_cents: number;
      currency: string | null;
    }[];
  }
  if (!isMissingFunction(error)) {
    console.error("[performance] perf_outstanding_invoices rpc failed:", error);
  }
  return fetchOutstandingViaRls(sb);
}

async function fetchOutstandingViaRls(
  sb: SupabaseClient,
): Promise<{ amount_cents: number; currency: string | null }[]> {
  const rows: { amount_cents: number; currency: string | null }[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
    const { data, error } = await sb
      .from("payment_requests")
      .select("amount_cents, currency")
      .eq("status", "requested")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("[performance] fetchOutstanding failed:", error);
      break;
    }
    const batch = (data ?? []) as unknown as {
      amount_cents: number;
      currency: string | null;
    }[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export async function loadMoneySection(
  range: ResolvedRange,
): Promise<MoneySection> {
  const sb = await getServerSupabase();
  const [paidRows, outstandingRows] = await Promise.all([
    fetchPaid(sb, range),
    fetchOutstanding(sb),
  ]);

  const paid: PaidInvoice[] = paidRows
    .filter((r) => r.paid_at != null)
    .map((r) => ({
      amountCents: r.amount_cents,
      paidAtMs: Date.parse(r.paid_at as string),
      createdAtMs: Date.parse(r.created_at),
      locksDeliverables: r.locks_deliverables === true,
      clientId: r.client_id,
    }));
  const outstanding: OutstandingInvoice[] = outstandingRows.map((r) => ({
    amountCents: r.amount_cents,
  }));

  // Client display names for the top-clients ranking (RLS-scoped to the firm).
  const clientIds = [
    ...new Set(
      paid.map((p) => p.clientId).filter((id): id is string => id != null),
    ),
  ];
  const clientNames = await fetchClientNames(sb, clientIds);

  // Vylan's market is CAD; carry the actual currency if the rows agree, else
  // fall back to cad. Mixed currencies are not expected in practice.
  const currency =
    paidRows[0]?.currency ?? outstandingRows[0]?.currency ?? "cad";

  return aggregateMoney(paid, outstanding, range, currency, clientNames);
}

async function fetchClientNames(
  sb: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  // Chunk so a very large all-time set stays within URL limits.
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await sb
      .from("clients")
      .select("id, display_name")
      .in("id", ids.slice(i, i + 300));
    if (error) {
      console.error("[performance] fetchClientNames failed:", error);
      continue;
    }
    for (const c of (data ?? []) as {
      id: string;
      display_name: string | null;
    }[]) {
      if (c.display_name) out.set(c.id, c.display_name);
    }
  }
  return out;
}

// Convenience for the page: resolve the range and load money in one call. The
// clock is read HERE (a lib function), not in the server component's render, so
// the page stays pure. `nowMs` is injectable for tests.
export async function loadMoney(
  range: PerformanceRange,
  nowMs: number = Date.now(),
): Promise<MoneySection> {
  return loadMoneySection(resolveRange(range, nowMs));
}
