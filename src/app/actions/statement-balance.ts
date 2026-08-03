"use server";

// Recording what a bank statement said, so the close board can do the
// comparison a reconciliation actually is.
//
// Only the statement figure is stored. The books side is re-read from the
// ledger every time the board is drawn, which is why this can never go stale
// the way a "reconciled ✓" checkbox does.

import {
  setStatementBalance,
  clearStatementBalance,
  StatementBalanceUnsupportedError,
} from "@/lib/db/bank-statement-balances";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { isPeriodKey, type PeriodKey } from "@/lib/close/period";

export type StatementBalanceResult = {
  ok: boolean;
  error?: string;
  // The table is not there yet — the UI shows the sentence rather than a
  // generic failure, because the fix is one SQL file.
  needsMigration?: boolean;
};

// The largest balance we will accept, in cents — a hair over $92 billion.
// Not a business rule, a typo guard: a mis-pasted account number arriving as
// a balance should be refused here rather than stored and silently reported
// as a nine-figure discrepancy forever.
const MAX_CENTS = 9_223_372_036_854;

export async function setStatementBalanceAction(input: {
  clientId: string;
  accountId: string;
  period: string;
  balanceCents: number;
}): Promise<StatementBalanceResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!isPeriodKey(input.period)) return { ok: false, error: "bad_period" };
  if (!input.clientId || !input.accountId) {
    return { ok: false, error: "bad_target" };
  }
  if (
    !Number.isFinite(input.balanceCents) ||
    !Number.isInteger(input.balanceCents) ||
    Math.abs(input.balanceCents) > MAX_CENTS
  ) {
    return { ok: false, error: "bad_amount" };
  }

  try {
    await setStatementBalance({
      firmId: firm.id,
      clientId: input.clientId,
      accountId: input.accountId,
      period: input.period as PeriodKey,
      balanceCents: input.balanceCents,
      userId: user.id,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof StatementBalanceUnsupportedError) {
      return { ok: false, error: e.message, needsMigration: true };
    }
    console.error("[statement-balance] set failed:", e);
    return { ok: false, error: "failed" };
  }
}

// Undo a figure typed against the wrong account or month. Deleting returns the
// account to "not entered" — as opposed to writing 0, which would read as a
// real, reconciled-to-empty balance.
export async function clearStatementBalanceAction(input: {
  clientId: string;
  accountId: string;
  period: string;
}): Promise<StatementBalanceResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!isPeriodKey(input.period)) return { ok: false, error: "bad_period" };

  try {
    await clearStatementBalance({
      clientId: input.clientId,
      accountId: input.accountId,
      period: input.period as PeriodKey,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof StatementBalanceUnsupportedError) {
      return { ok: false, error: e.message, needsMigration: true };
    }
    console.error("[statement-balance] clear failed:", e);
    return { ok: false, error: "failed" };
  }
}
