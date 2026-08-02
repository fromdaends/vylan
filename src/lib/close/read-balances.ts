// Fetching the books half of a bank reconciliation from each ledger.
//
// Thin on purpose: every function here does one HTTP read and hands the JSON
// to a PURE parser in book-balance.ts. The shapes are tested there against
// fixtures, which is the only way this code could be tested at all — this
// machine has no QuickBooks credentials.
//
// NOTHING HERE THROWS AT THE CALLER. A ledger that will not answer — expired
// token, missing scope, a user without Xero's "reports" role, a 500 at Intuit
// — comes back as balances of null, which the board renders as "could not
// read the books". A close board that 500s because one client's token lapsed
// is a close board nobody opens on the 1st of the month.

import { xeroGet } from "@/lib/xero/client";
import type { QuickbooksEnvironment } from "@/lib/quickbooks/client";
import {
  parseXeroBankSummary,
  parseQuickbooksBalances,
  type BookBalance,
} from "@/lib/close/book-balance";

export type BalanceReadResult = {
  accounts: BookBalance[];
  // Why the books could not be read, when they could not. The board turns this
  // into a sentence the firm can act on rather than a shrug.
  problem: "none" | "reconnect_required" | "unavailable";
};

const EMPTY: BalanceReadResult = { accounts: [], problem: "unavailable" };

// ---------------------------------------------------------------------------
// Xero — BankSummary for the period.
// ---------------------------------------------------------------------------
export async function readXeroBookBalances(
  ctx: { accessToken: string; tenantId: string },
  period: { from: string; to: string },
  kindById?: Map<string, "bank" | "credit_card">,
): Promise<BalanceReadResult> {
  try {
    const json = await xeroGet(
      ctx.accessToken,
      ctx.tenantId,
      `Reports/BankSummary?fromDate=${period.from}&toDate=${period.to}`,
    );
    // Xero wraps reports in a Reports array of one.
    const report = Array.isArray(json.Reports)
      ? (json.Reports[0] as { Rows?: unknown[] } | undefined)
      : undefined;
    const accounts = parseXeroBankSummary(
      report as Parameters<typeof parseXeroBankSummary>[0],
      kindById,
    );
    return { accounts, problem: "none" };
  } catch (e) {
    // A 403 here is almost always the scope: connections made before
    // accounting.reports.read was requested cannot read any report, and only
    // reconnecting fixes it. Xero's own "reports" user role can also be
    // missing, which reconnecting will NOT fix — so the wording the board
    // shows stays about reconnecting first, not a promise.
    const message = e instanceof Error ? e.message : "";
    return {
      ...EMPTY,
      problem: /\b403\b/.test(message) ? "reconnect_required" : "unavailable",
    };
  }
}

// ---------------------------------------------------------------------------
// QuickBooks — TrialBalance at period end.
// ---------------------------------------------------------------------------
//
// Account.CurrentBalance is deliberately NOT used: it carries no as-of date,
// so reconciling July against it would compare today's books to July's
// statement and call the difference a discrepancy.
export async function readQuickbooksBookBalances(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  period: { from: string; to: string },
  accounts: Map<string, { name: string; kind: "bank" | "credit_card" }>,
): Promise<BalanceReadResult> {
  if (accounts.size === 0) return { accounts: [], problem: "none" };
  try {
    // The Reports API is a plain GET, not the SQL-ish query endpoint, so this
    // borrows quickbooksQuery's host/auth handling by path only.
    const json = (await quickbooksReport(
      ctx,
      `TrialBalance?start_date=${period.from}&end_date=${period.to}`,
    )) as Parameters<typeof parseQuickbooksBalances>[0];
    return { accounts: parseQuickbooksBalances(json, accounts), problem: "none" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return {
      // Still list every account, as null — an account that disappears from a
      // reconciliation screen is how a month gets closed on books nobody saw.
      accounts: parseQuickbooksBalances(null, accounts),
      problem: /\b401\b|\b403\b/.test(message)
        ? "reconnect_required"
        : "unavailable",
    };
  }
}

// One report GET against the QuickBooks Reports API. Kept here rather than in
// the QuickBooks client because this is the only caller; if a second one
// appears it should move next to quickbooksQuery.
async function quickbooksReport(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  path: string,
): Promise<unknown> {
  const host =
    ctx.environment === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  const res = await fetch(
    `${host}/v3/company/${ctx.realmId}/reports/${path}&minorversion=75`,
    {
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    throw new Error(`QuickBooks report ${path} failed (${res.status})`);
  }
  return res.json();
}
