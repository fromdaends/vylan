// Reading and writing "what the bank statement said this account held".
//
// The one half of a bank reconciliation no ledger API will give us. The books
// half is read live from QuickBooks/Xero every time the board is drawn; only
// the statement figure is stored, because only a human has it.
//
// READS DEGRADE, WRITES REFUSE — the same contract as month-close (1201).
// Before migration 1220 is applied there is no table: a read truthfully
// returns "no statement balances entered", which is exactly what the board
// should show, and a write says so in a sentence naming the file to run
// instead of failing with a Postgres error nobody can act on.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { periodStart, type PeriodKey } from "@/lib/close/period";

export class StatementBalanceUnsupportedError extends Error {
  constructor() {
    super(
      "Recording a statement balance needs database update 1220. Run supabase/migrations/1220_bank_statement_balances.sql, then try again.",
    );
    this.name = "StatementBalanceUnsupportedError";
  }
}

// Key for the per-account lookup. The ledger's account id is only meaningful
// alongside the client whose books it came from — two clients can both have an
// account "1" — so the client is always part of the key.
export function statementKey(clientId: string, accountId: string): string {
  return `${clientId}:${accountId}`;
}

// Every statement balance this firm has entered for `period`, keyed by
// client+account. Empty map both when none are entered and when the table does
// not exist yet: for a reader those are the same answer.
export async function listStatementBalances(
  period: PeriodKey,
): Promise<Map<string, number>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("bank_statement_balances")
    .select("client_id, account_id, statement_balance_cents")
    .eq("period", periodStart(period));
  if (error) {
    if (isMissingSchema(error)) return new Map();
    throw error;
  }
  const out = new Map<string, number>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const clientId = typeof r.client_id === "string" ? r.client_id : null;
    const accountId = typeof r.account_id === "string" ? r.account_id : null;
    // Postgres bigint arrives as a string through PostgREST; Number() is exact
    // here because a balance in cents is nowhere near 2^53.
    const cents = Number(r.statement_balance_cents);
    if (!clientId || !accountId || !Number.isFinite(cents)) continue;
    out.set(statementKey(clientId, accountId), cents);
  }
  return out;
}

// Record (or correct) one account's statement balance for one month.
//
// Upserts on (client_id, account_id, period): typing a corrected figure
// replaces the old one rather than stacking a second opinion, and two people
// entering the same statement at once is a no-op rather than a failure either
// of them has to think about.
export async function setStatementBalance(input: {
  firmId: string;
  clientId: string;
  accountId: string;
  period: PeriodKey;
  balanceCents: number;
  userId: string | null;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("bank_statement_balances").upsert(
    {
      firm_id: input.firmId,
      client_id: input.clientId,
      account_id: input.accountId,
      period: periodStart(input.period),
      statement_balance_cents: input.balanceCents,
      entered_by: input.userId,
      entered_at: new Date().toISOString(),
    },
    { onConflict: "client_id,account_id,period" },
  );
  if (error) {
    if (isMissingSchema(error)) throw new StatementBalanceUnsupportedError();
    throw error;
  }
}

// Remove a statement balance — the way to undo a figure typed against the
// wrong account or month. Absence means "not entered", so deleting genuinely
// returns the account to unknown rather than leaving a zero behind, which
// would read as a real balance.
export async function clearStatementBalance(input: {
  clientId: string;
  accountId: string;
  period: PeriodKey;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("bank_statement_balances")
    .delete()
    .eq("client_id", input.clientId)
    .eq("account_id", input.accountId)
    .eq("period", periodStart(input.period));
  if (error) {
    if (isMissingSchema(error)) throw new StatementBalanceUnsupportedError();
    throw error;
  }
}
