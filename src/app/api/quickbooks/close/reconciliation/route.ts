// "Is this client's bank reconciliation done for the month?" — one client, on
// demand.
//
// Same on-demand shape as the sibling close/check route, and for the same
// reason: this reads the client's books live, so a board that did it for
// thirty clients on page load would make thirty report calls before drawing
// anything.
//
// Works for BOTH ledgers. Xero answers with the BankSummary report (period-end
// closing balance per bank account, which is exactly the number a
// reconciliation needs); QuickBooks answers with TrialBalance at period end,
// because Account.CurrentBalance carries no as-of date and would compare
// today's books against last month's statement.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { getXeroReadContext } from "@/lib/xero/connection";
import { readAccounts } from "@/lib/quickbooks/uncategorized";
import { readCachedXeroLists } from "@/lib/db/xero-cache";
import {
  readQuickbooksBookBalances,
  readXeroBookBalances,
} from "@/lib/close/read-balances";
import {
  listStatementBalances,
  statementKey,
} from "@/lib/db/bank-statement-balances";
import {
  summarizeReconciliation,
  type ReconAccount,
} from "@/lib/close/reconciliation";
import { isPeriodKey, periodStart, periodEnd } from "@/lib/close/period";

export const runtime = "nodejs";
// One report call plus a chart-of-accounts read.
export const maxDuration = 60;

// QuickBooks account types that hold money a statement can be reconciled
// against. Everything else in a trial balance is irrelevant here.
function qboKind(type: string | null): "bank" | "credit_card" | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === "bank") return "bank";
  if (t === "credit card" || t === "creditcard") return "credit_card";
  return null;
}

function xeroKind(
  type: string | null | undefined,
  bankType: string | null | undefined,
): "bank" | "credit_card" | null {
  if ((type ?? "").toUpperCase() !== "BANK") return null;
  return (bankType ?? "").toUpperCase() === "CREDITCARD"
    ? "credit_card"
    : "bank";
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const firm = await getCurrentFirm();
  if (!firm) return NextResponse.json({ error: "no_firm" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : null;
  const period = typeof body?.period === "string" ? body.period : null;
  if (!clientId || !period || !isPeriodKey(period)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // The client must belong to this firm — read under RLS, which IS the check.
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const range = { from: periodStart(period), to: periodEnd(period) };

  // QuickBooks first: it is the side with the working ledger scans, so a
  // client connected to both reconciles there.
  const qbo = await getQuickbooksReadContext(firm.id, clientId);
  let read;
  if (qbo) {
    const wanted = new Map<string, { name: string; kind: "bank" | "credit_card" }>();
    for (const account of await readAccounts(qbo)) {
      const kind = qboKind(account.accountType);
      if (kind && account.active) {
        wanted.set(account.id, { name: account.name, kind });
      }
    }
    read = await readQuickbooksBookBalances(qbo, range, wanted);
  } else {
    const xero = await getXeroReadContext(firm.id, clientId);
    if (!xero) {
      return NextResponse.json({ error: "not_connected" }, { status: 409 });
    }
    // BankSummary does not say which accounts are credit cards; the cached
    // chart of accounts does.
    const lists = await readCachedXeroLists(clientId);
    const kinds = new Map<string, "bank" | "credit_card">();
    for (const a of lists?.accounts ?? []) {
      const kind = xeroKind(
        (a as { accountType?: string | null }).accountType ?? null,
        (a as { bankAccountType?: string | null }).bankAccountType ?? null,
      );
      if (kind) kinds.set(a.id, kind);
    }
    read = await readXeroBookBalances(xero, range, kinds);
  }

  // Pair each account's book balance with whatever statement figure the firm
  // has typed for this month. A missing figure stays null → "unknown", never
  // a zero that would read as reconciled.
  const statements = await listStatementBalances(period);
  const accounts: ReconAccount[] = read.accounts.map((a) => ({
    accountId: a.accountId,
    name: a.name,
    kind: a.kind,
    bookBalanceCents: a.balanceCents,
    statementBalanceCents:
      statements.get(statementKey(clientId, a.accountId)) ?? null,
  }));

  return NextResponse.json({
    ok: true,
    problem: read.problem,
    accounts,
    summary: summarizeReconciliation(accounts),
  });
}
