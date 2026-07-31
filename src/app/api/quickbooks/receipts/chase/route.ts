// Ask a client for the receipts behind expenses that have none.
//
// The browser sends WHICH transactions to chase, never WHAT they are. The server
// re-scans the client's books and only creates a request for a transaction that
// is genuinely a gap right now — same rule as the bulk-approve route, and it
// matters more here: a client-supplied description would let a crafted request
// put arbitrary text in front of a client, and a client-supplied transaction id
// would let it wire a future receipt onto any entry in their ledger.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { scanReceiptGaps, gapKey } from "@/lib/quickbooks/receipt-gap";
import {
  createReceiptChaseItems,
  LedgerRefUnsupportedError,
} from "@/lib/db/receipt-chase";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export const runtime = "nodejs";
// A scan queries the ledger twice and the send writes a row per gap.
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
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const clientId = typeof body.clientId === "string" ? body.clientId : null;
  const engagementId =
    typeof body.engagementId === "string" ? body.engagementId : null;
  const from = typeof body.from === "string" ? body.from : null;
  const to = typeof body.to === "string" ? body.to : null;
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((k): k is string => typeof k === "string")
    : [];
  if (!clientId || !engagementId || !from || !to || keys.length === 0) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // The engagement must belong to this firm AND to the client whose books we
  // are about to read. Read under RLS, which IS the firm authorization; the
  // client check stops one client's expenses being asked about in another
  // client's portal.
  const { data: engagement } = await supabase
    .from("engagements")
    .select("id, client_id, status")
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement || engagement.client_id !== clientId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (engagement.status === "cancelled" || engagement.status === "complete") {
    // A completed engagement's portal refuses uploads, so the client would see
    // a question they physically cannot answer.
    return NextResponse.json(
      {
        error: "engagement_closed",
        detail:
          "That engagement is closed, so the client can't upload to it. Reopen it or pick another.",
      },
      { status: 409 },
    );
  }

  const ctx = await getQuickbooksReadContext(firm.id, clientId);
  if (!ctx) {
    return NextResponse.json({ error: "not_connected" }, { status: 409 });
  }

  let scan;
  try {
    scan = await scanReceiptGaps(ctx, { from, to });
  } catch (err) {
    console.error("[receipt chase] scan failed:", err);
    return NextResponse.json(
      { error: "scan_failed", detail: "Couldn't read the client's books." },
      { status: 502 },
    );
  }

  // Intersect: only chase what the books still say is unsupported. A receipt
  // attached between the firm loading the page and pressing the button drops
  // out here rather than producing a question the client already answered.
  const wanted = new Set(keys);
  const gaps = scan.gaps.filter((g) => wanted.has(gapKey(g.entity, g.qboId)));
  if (gaps.length === 0) {
    return NextResponse.json({ ok: true, created: 0, skippedDuplicate: 0, stale: keys.length });
  }

  try {
    const result = await createReceiptChaseItems({ engagementId, gaps });
    revalidateAllLocales(`/engagements/${engagementId}`);
    revalidateAllLocales(`/quickbooks/receipts`);
    try {
      await logUserActivity(firm.id, engagementId, "request_receipts", {
        client_id: clientId,
        count: result.created,
      });
    } catch (err) {
      console.error("[receipt chase] audit log failed (items created):", err);
    }
    return NextResponse.json({
      ok: true,
      ...result,
      stale: keys.length - gaps.length,
    });
  } catch (err) {
    if (err instanceof LedgerRefUnsupportedError) {
      return NextResponse.json(
        { error: "migration_required", detail: err.message },
        { status: 409 },
      );
    }
    console.error("[receipt chase] create failed:", err);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
