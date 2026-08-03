"use server";

// Closing and reopening a client's month.
//
// Two actions, both idempotent, both returning a plain result the board renders
// rather than throwing at the client. Closing an already-closed month and
// reopening an already-open one are normal things to happen on a board two
// people are looking at, and neither should produce an error anybody has to
// think about.
//
// This file exports async functions ONLY. A "use server" module that exports a
// constant or a type compiles fine and then fails at build time with an error
// that names the wrong thing — see the deploy-skew lesson in docs.

import { getCurrentFirm } from "@/lib/db/firms";
import {
  closeMonth,
  reopenMonth,
  MonthCloseUnsupportedError,
} from "@/lib/db/month-close";
import { isPeriodKey } from "@/lib/close/period";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export type CloseMonthResult = {
  ok: boolean;
  /** Set when the database update has not been applied yet. */
  needsMigration?: boolean;
  error?: string;
};

export async function closeMonthAction(input: {
  clientId: string;
  period: string;
  note?: string | null;
}): Promise<CloseMonthResult> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "no_firm" };
  if (!isPeriodKey(input.period)) return { ok: false, error: "bad_period" };
  if (!input.clientId) return { ok: false, error: "bad_client" };

  try {
    await closeMonth({
      firmId: firm.id,
      clientId: input.clientId,
      period: input.period,
      note: input.note ?? null,
    });
  } catch (err) {
    if (err instanceof MonthCloseUnsupportedError) {
      return { ok: false, needsMigration: true, error: err.message };
    }
    console.error("[month close] close failed:", err);
    return { ok: false, error: "close_failed" };
  }

  // The close itself is done. A failed audit write must not report it as failed
  // — that invites a second attempt at something already true.
  try {
    await logUserActivity(firm.id, null, "close_month", {
      client_id: input.clientId,
      period: input.period,
    });
  } catch (err) {
    console.error("[month close] audit log failed (month closed):", err);
  }
  // /quickbooks/close is a REDIRECT stub — the close board moved onto
  // /quickbooks/drafts, and this path was never updated with it, so this call
  // has been revalidating a route that only issues a 307. The board itself
  // calls router.refresh() after a successful close, which is why nobody saw
  // it. The client page's Bookkeeping tab renders the same board and is
  // covered by that same refresh.
  revalidateAllLocales("/quickbooks/drafts");
  return { ok: true };
}

export async function reopenMonthAction(input: {
  clientId: string;
  period: string;
}): Promise<CloseMonthResult> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "no_firm" };
  if (!isPeriodKey(input.period)) return { ok: false, error: "bad_period" };
  if (!input.clientId) return { ok: false, error: "bad_client" };

  try {
    await reopenMonth({ clientId: input.clientId, period: input.period });
  } catch (err) {
    if (err instanceof MonthCloseUnsupportedError) {
      return { ok: false, needsMigration: true, error: err.message };
    }
    console.error("[month close] reopen failed:", err);
    return { ok: false, error: "reopen_failed" };
  }

  try {
    await logUserActivity(firm.id, null, "reopen_month", {
      client_id: input.clientId,
      period: input.period,
    });
  } catch (err) {
    console.error("[month close] audit log failed (month reopened):", err);
  }
  // /quickbooks/close is a REDIRECT stub — the close board moved onto
  // /quickbooks/drafts, and this path was never updated with it, so this call
  // has been revalidating a route that only issues a 307. The board itself
  // calls router.refresh() after a successful close, which is why nobody saw
  // it. The client page's Bookkeeping tab renders the same board and is
  // covered by that same refresh.
  revalidateAllLocales("/quickbooks/drafts");
  return { ok: true };
}
