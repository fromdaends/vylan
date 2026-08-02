// "Where does this client's month actually stand?" — one client, on demand.
//
// ON DEMAND IS THE WHOLE DESIGN. Both answers come from reading the client's
// books live, and a board that scanned every client on page load would open a
// firm with thirty clients by making a hundred and twenty QuickBooks calls
// before drawing anything — slow enough to time out, and rude enough to get
// rate limited. So the board loads instantly from the database and each row
// fetches its own ledger numbers when asked.
//
// The alternative — storing the counts and refreshing them on a schedule — is a
// bigger feature than this one and lies by exactly as much as it is stale. A
// close board that quietly shows last week's numbers is worse than none.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { scanUncategorized } from "@/lib/quickbooks/uncategorized";
import { scanReceiptGaps } from "@/lib/quickbooks/receipt-gap";
import { isPeriodKey, periodStart, periodEnd } from "@/lib/close/period";

export const runtime = "nodejs";
// Two scans, five ledger queries between them.
export const maxDuration = 60;

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
  const period = typeof body.period === "string" ? body.period : null;
  if (!clientId || !period || !isPeriodKey(period)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // The client must belong to this firm. Read under RLS, which IS the firm
  // authorization — another firm's client id returns nothing here.
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

  const from = periodStart(period);
  const to = periodEnd(period);

  try {
    // Sequential, not parallel: the two scans hit the same company, and Intuit
    // rate limits per realm. Five queries in a row is comfortably inside the
    // limit; ten at once is how a firm checking several clients starts getting
    // 429s that look like the feature is broken.
    const uncat = await scanUncategorized(ctx, { from, to });
    const receipts = await scanReceiptGaps(ctx, { from, to });
    return NextResponse.json({
      ok: true,
      period,
      uncategorized: uncat.txns.length,
      missingReceipts: receipts.gaps.length,
      considered: uncat.considered,
      // A truncated read means the numbers are floors, not totals. The board
      // says so rather than presenting a partial count as the answer.
      truncated: uncat.truncated || receipts.truncated,
    });
  } catch (err) {
    // "We could not look" must never come back as zero. A close board that
    // reports a clean month because a token expired is the single worst thing
    // this feature could do.
    console.error("[close check] scan failed:", err);
    return NextResponse.json(
      { error: "scan_failed", detail: "Couldn't read this client's books." },
      { status: 502 },
    );
  }
}
