// Reading and writing "this client's month is finished".
//
// The one fact a close board cannot derive. Everything else it shows — uncoded
// transactions, missing receipts, unanswered requests — is read live from the
// books and the checklist. Only "we are done with July" is a decision a human
// made, so only that is stored.
//
// READS DEGRADE, WRITES REFUSE. Before migration 1200 is applied there is no
// table: a read then truthfully returns "nothing is closed", which is exactly
// what the board should show, and a write says so instead of failing with a
// Postgres error nobody can act on. Neither direction can corrupt anything —
// unlike the receipt chase, where degrading would have silently double-counted
// a client's expenses.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { periodStart, type PeriodKey } from "@/lib/close/period";

export type MonthClose = {
  clientId: string;
  period: PeriodKey;
  closedAt: string;
  closedBy: string | null;
  note: string | null;
};

export class MonthCloseUnsupportedError extends Error {
  constructor() {
    super(
      "Closing a month needs database update 1200. Run supabase/migrations/1200_month_end_closes.sql, then try again.",
    );
    this.name = "MonthCloseUnsupportedError";
  }
}

// Which of this firm's clients have `period` closed, keyed by client id.
//
// Returns an EMPTY map both when nothing is closed and when the table does not
// exist yet. Those are the same answer for a reader — no month is closed — and
// the difference only matters on the write path, which refuses explicitly.
export async function listClosesForPeriod(
  period: PeriodKey,
): Promise<Map<string, MonthClose>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("month_end_closes")
    .select("client_id, period, closed_at, closed_by, note")
    .eq("period", periodStart(period));
  if (error) {
    if (isMissingSchema(error)) return new Map();
    throw error;
  }
  const out = new Map<string, MonthClose>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const clientId = typeof r.client_id === "string" ? r.client_id : null;
    if (!clientId) continue;
    out.set(clientId, {
      clientId,
      period,
      closedAt: String(r.closed_at ?? ""),
      closedBy: typeof r.closed_by === "string" ? r.closed_by : null,
      note: typeof r.note === "string" ? r.note : null,
    });
  }
  return out;
}

// Declare one client's month finished.
//
// Upserts on (client_id, period): closing an already-closed month is a no-op
// rather than a second row or an error. Two people pressing the button at the
// same moment is a normal thing to happen on a shared board, and it should not
// produce a failure either of them has to think about.
export async function closeMonth(input: {
  firmId: string;
  clientId: string;
  period: PeriodKey;
  note?: string | null;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("month_end_closes").upsert(
    {
      firm_id: input.firmId,
      client_id: input.clientId,
      period: periodStart(input.period),
      closed_by: auth.user?.id ?? null,
      note: input.note?.trim() || null,
    },
    { onConflict: "client_id,period" },
  );
  if (error) {
    if (isMissingSchema(error)) throw new MonthCloseUnsupportedError();
    throw error;
  }
}

// Reopen a month by DELETING the row.
//
// A reopened month is indistinguishable from one that was never closed, which
// is what reopening means. Who closed it and who reopened it lives in the
// activity log, which is the right home for history — not a graveyard of
// superseded rows in here.
export async function reopenMonth(input: {
  clientId: string;
  period: PeriodKey;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("month_end_closes")
    .delete()
    .eq("client_id", input.clientId)
    .eq("period", periodStart(input.period));
  if (error) {
    if (isMissingSchema(error)) throw new MonthCloseUnsupportedError();
    throw error;
  }
}

// How many things each client still owes the firm, across engagements the
// client can actually act on.
//
// One query for every client on the board rather than one per client: a firm
// with thirty clients would otherwise open this page with thirty round trips
// before it drew anything.
export async function countOpenRequestsByClient(
  clientIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (clientIds.length === 0) return out;
  const supabase = await getServerSupabase();

  const { data: engagements, error: engErr } = await supabase
    .from("engagements")
    .select("id, client_id, status")
    .in("client_id", clientIds);
  if (engErr) throw engErr;

  const liveEngagements = (engagements ?? []).filter(
    (e) =>
      (e as { status?: string }).status !== "complete" &&
      (e as { status?: string }).status !== "cancelled",
  ) as Array<{ id: string; client_id: string }>;
  if (liveEngagements.length === 0) return out;

  const clientOf = new Map(liveEngagements.map((e) => [e.id, e.client_id]));
  const { data: items, error: itemErr } = await supabase
    .from("request_items")
    .select("engagement_id, status")
    .in(
      "engagement_id",
      liveEngagements.map((e) => e.id),
    )
    .eq("status", "pending");
  if (itemErr) throw itemErr;

  for (const it of (items ?? []) as Array<{ engagement_id: string }>) {
    const clientId = clientOf.get(it.engagement_id);
    if (!clientId) continue;
    out.set(clientId, (out.get(clientId) ?? 0) + 1);
  }
  return out;
}
