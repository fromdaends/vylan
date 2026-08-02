// Code one parked transaction, in the client's real books.
//
// The browser sends WHICH transaction and WHICH account. It never sends which
// lines, and it never sends what the transaction is — the server re-reads the
// transaction and works both out for itself. Same discipline as the receipt
// chase route, and it matters more here because this one WRITES: a caller that
// could name lines could re-point any line of any transaction in the client's
// ledger, including ones a human deliberately coded.
//
// Authorization is sign-in plus RLS, matching the existing ledger-write path
// (suggestions/[fileId]/post). There is no separate "may write to the books"
// capability in the model today, and inventing one here — where it would apply
// to this route and nothing else — would be a permissions change wearing a
// feature's clothes.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { QuickbooksError } from "@/lib/quickbooks/client";
import {
  readAccounts,
  uncategorizedAmong,
  isUncategorizedAccountName,
  type UncatEntity,
} from "@/lib/quickbooks/uncategorized";
import {
  recategorizeTransaction,
  isQboId,
} from "@/lib/quickbooks/recategorize";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export const runtime = "nodejs";
// Three ledger calls: the chart of accounts, the transaction, the write.
export const maxDuration = 60;

const ENTITIES: readonly UncatEntity[] = ["purchase", "bill", "deposit"];

function isUncatEntity(x: unknown): x is UncatEntity {
  return typeof x === "string" && (ENTITIES as readonly string[]).includes(x);
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }
  const firm = await getCurrentFirm();
  if (!firm) return NextResponse.json({ error: "no_firm" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : null;
  const txnId = typeof body.txnId === "string" ? body.txnId : null;
  const accountId = typeof body.accountId === "string" ? body.accountId : null;
  const entity = isUncatEntity(body.entity) ? body.entity : null;
  if (!clientId || !entity || !txnId || !accountId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  // Both ids are interpolated into QuickBooks' query language downstream.
  if (!isQboId(txnId) || !isQboId(accountId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  // The client must belong to this firm. Read under RLS, which IS the firm
  // authorization — a client id from another firm returns nothing here.
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ctx = await getQuickbooksReadContext(firm.id, clientId);
  if (!ctx) {
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }

  let accounts;
  try {
    accounts = await readAccounts(ctx);
  } catch (err) {
    console.error("[uncategorized] account read failed:", err);
    return NextResponse.json(
      { error: "scan_failed", detail: "Couldn't read this client's accounts." },
      { status: 502 },
    );
  }

  const target = accounts.find((a) => a.id === accountId);
  if (!target || !target.active) {
    return NextResponse.json(
      {
        error: "bad_account",
        detail: "That account isn't in this client's books any more.",
      },
      { status: 409 },
    );
  }
  // Moving something from one parking account to another is not a fix, and a
  // firm that did it by accident would think the work was done.
  if (isUncategorizedAccountName(target.name)) {
    return NextResponse.json(
      {
        error: "bad_account",
        detail: "That's another uncategorised account — pick a real one.",
      },
      { status: 409 },
    );
  }

  const parkingAccountIds = new Set(
    uncategorizedAmong(accounts).map((a) => a.id),
  );

  try {
    const result = await recategorizeTransaction(ctx, {
      entity,
      txnId,
      parkingAccountIds,
      account: { id: target.id, name: target.name },
    });
    if (!result.ok) {
      // Neither of these is a failure: the entry is gone, or somebody coded it
      // first. The screen says so and refreshes rather than showing an error.
      return NextResponse.json({ ok: true, applied: false, reason: result.reason });
    }

    revalidateAllLocales("/quickbooks/uncategorized");
    try {
      await logUserActivity(firm.id, null, "categorize_transaction", {
        client_id: clientId,
        entity,
        txn_id: txnId,
        account_id: target.id,
        account_name: target.name,
        lines: result.changed,
        amount: result.amount,
      });
    } catch (err) {
      // The books are already updated. An audit-log failure must not report the
      // write as failed — that would invite a second, duplicate attempt.
      console.error("[uncategorized] audit log failed (books updated):", err);
    }
    return NextResponse.json({
      ok: true,
      applied: true,
      changed: result.changed,
      account: target.name,
    });
  } catch (err) {
    // QuickBooks' own refusal is the most useful thing we can say — it names the
    // account type it will not accept, which no message of ours could guess.
    if (err instanceof QuickbooksError) {
      console.error("[uncategorized] write refused:", err.message);
      return NextResponse.json(
        { error: "write_failed", detail: err.message },
        { status: 502 },
      );
    }
    console.error("[uncategorized] write failed:", err);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
}
