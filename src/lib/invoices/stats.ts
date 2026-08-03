// The four numbers across the top of Billing → Invoices.
//
// Operational, not analytical: what is owed right now, what is late right now,
// what came in this month, and how long clients actually take. Trend lines and
// history are deliberately not here.
//
// COLLECTED THIS MONTH IS THE AWKWARD ONE, and it is worth saying why. The
// payment ledger (migration 1260) is the right source — it is the only thing
// that knows about a partial payment, and the only thing with a real received
// date. But invoices settled BEFORE 1260 have no ledger rows at all. Counting
// only the ledger would make the founder's collected figure drop to near zero
// the day this ships, which is worse than useless: it is wrong in a direction
// that looks like a bug in the money.
//
// So: ledger rows in the month, PLUS invoices marked paid in the month that
// have no ledger row of their own. The second set empties itself as soon as
// 1260 is applied (every rail payment writes a ledger row from then on), so
// this is a bridge that retires quietly rather than a permanent double-count —
// and the id exclusion makes double-counting impossible in the meantime.

import { getServerSupabase } from "@/lib/supabase/server";
import { isoDay, outstandingCents } from "@/lib/invoices/outstanding";
import { isLedgerSchemaMissing } from "@/lib/db/invoice-payments";

export type BillingStats = {
  outstandingCents: number;
  overdueCents: number;
  collectedThisMonthCents: number;
  // null when nothing has been paid yet — "0 days" would read as instant
  // payment, which is the opposite of the truth.
  averageDaysToPaid: number | null;
  // How many paid invoices the average is built from, so the UI can decline to
  // show a confident number off two data points.
  averageSampleSize: number;
};

const EMPTY: BillingStats = {
  outstandingCents: 0,
  overdueCents: 0,
  collectedThisMonthCents: 0,
  averageDaysToPaid: null,
  averageSampleSize: 0,
};

function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "PGRST204" || err?.code === "42703";
}

function monthStart(today: Date): string {
  return `${today.toISOString().slice(0, 7)}-01`;
}

export async function loadBillingStats(
  today: Date = new Date(),
): Promise<BillingStats> {
  const sb = await getServerSupabase();
  const todayIso = isoDay(today);
  const from = monthStart(today);

  // ── Owed and late ─────────────────────────────────────────────────────
  // Summed in JS over the open invoices only. An accounting firm's open
  // invoices are tens of rows, not thousands, so this is one small query
  // rather than a view that would have to be kept in step with the status
  // rules in outstanding.ts.
  // Typed loosely on purpose: the two selects differ by one column (the tiered
  // pre-1260 fallback), and PostgREST's inferred row types are structurally
  // incompatible as a result. Every field is read defensively below anyway.
  const openCols =
    "id, amount_cents, amount_paid_cents, status, due_date, paid_at, created_at";
  const selectOpen = (cols: string) =>
    sb
      .from("payment_requests")
      .select(cols)
      .in("status", ["requested", "failed"]);
  let open = (await selectOpen(openCols)) as {
    data: unknown[] | null;
    error: { code?: string } | null;
  };
  if (open.error && isMissingColumn(open.error)) {
    open = (await selectOpen(
      "id, amount_cents, status, due_date, paid_at, created_at",
    )) as { data: unknown[] | null; error: { code?: string } | null };
  }
  if (open.error) {
    console.error("[invoices/stats] open query failed:", open.error);
    return EMPTY;
  }

  let outstanding = 0;
  let overdue = 0;
  for (const r of (open.data ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const rest = outstandingCents({
      status: r.status as "requested" | "failed",
      amount_cents: r.amount_cents as number,
      amount_paid_cents: (r.amount_paid_cents as number | undefined) ?? 0,
      due_date: (r.due_date as string | null) ?? null,
    });
    outstanding += rest;
    const due = r.due_date as string | null;
    if (due && due < todayIso) overdue += rest;
  }

  // ── Collected this month ──────────────────────────────────────────────
  const [ledger, paidThisMonth] = await Promise.all([
    sb
      .from("invoice_payments")
      .select("payment_request_id, amount_cents")
      .gte("paid_on", from)
      .lte("paid_on", todayIso),
    sb
      .from("payment_requests")
      .select("id, amount_cents, paid_at")
      .eq("status", "paid")
      .gte("paid_at", `${from}T00:00:00Z`),
  ]);

  let collected = 0;
  const ledgerInvoiceIds = new Set<string>();
  if (ledger.error) {
    if (!isLedgerSchemaMissing(ledger.error)) {
      console.error("[invoices/stats] ledger query failed:", ledger.error);
    }
  } else {
    for (const p of ledger.data ?? []) {
      collected += p.amount_cents as number;
      ledgerInvoiceIds.add(p.payment_request_id as string);
    }
  }
  if (paidThisMonth.error) {
    console.error(
      "[invoices/stats] paid query failed:",
      paidThisMonth.error,
    );
  } else {
    for (const inv of paidThisMonth.data ?? []) {
      // Only the ones the ledger doesn't already account for.
      if (ledgerInvoiceIds.has(inv.id as string)) continue;
      collected += inv.amount_cents as number;
    }
  }

  // ── Average days to paid ──────────────────────────────────────────────
  // Over the last 12 months, so the number describes how the firm's clients
  // behave now rather than averaging in an invoice from three years ago.
  const yearAgo = new Date(today);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const settled = await sb
    .from("payment_requests")
    .select("created_at, paid_at")
    .eq("status", "paid")
    .gte("paid_at", yearAgo.toISOString());

  let totalDays = 0;
  let sample = 0;
  if (settled.error) {
    console.error("[invoices/stats] settled query failed:", settled.error);
  } else {
    for (const r of settled.data ?? []) {
      const created = Date.parse(r.created_at as string);
      const paid = Date.parse(r.paid_at as string);
      if (!Number.isFinite(created) || !Number.isFinite(paid)) continue;
      const days = (paid - created) / 86_400_000;
      // A negative span means clock skew or a hand-edited row; counting it
      // would drag the average below zero and read as nonsense.
      if (days < 0) continue;
      totalDays += days;
      sample += 1;
    }
  }

  return {
    outstandingCents: outstanding,
    overdueCents: overdue,
    collectedThisMonthCents: collected,
    averageDaysToPaid: sample > 0 ? Math.round(totalDays / sample) : null,
    averageSampleSize: sample,
  };
}
