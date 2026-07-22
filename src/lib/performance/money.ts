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
import type { ResolvedRange } from "./range";
import type { MoneySection } from "./types";

const PAGE = 1000;
const MAX_ROWS = 50_000;

function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}

type PaidRow = {
  amount_cents: number;
  currency: string | null;
  created_at: string;
  paid_at: string | null;
  locks_deliverables?: boolean | null;
};

// Tiered select: try with locks_deliverables (migration 0610) and fall back to
// the legacy shape if that column is absent, treating those invoices as
// unlocked — so the money section still renders on an un-migrated environment.
async function fetchPaid(
  sb: SupabaseClient,
  range: ResolvedRange,
): Promise<PaidRow[]> {
  const withLock =
    "amount_cents, currency, created_at, paid_at, locks_deliverables";
  const legacy = "amount_cents, currency, created_at, paid_at";
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
  const rows: { amount_cents: number; currency: string | null }[] = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
    const { data, error } = await sb
      .from("payment_requests")
      .select("amount_cents, currency")
      .eq("status", "requested")
      .order("created_at", { ascending: false })
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
    }));
  const outstanding: OutstandingInvoice[] = outstandingRows.map((r) => ({
    amountCents: r.amount_cents,
  }));

  // Vylan's market is CAD; carry the actual currency if the rows agree, else
  // fall back to cad. Mixed currencies are not expected in practice.
  const currency =
    paidRows[0]?.currency ?? outstandingRows[0]?.currency ?? "cad";

  return aggregateMoney(paid, outstanding, range, currency);
}
