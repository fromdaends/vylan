// Ask a client what their uncoded transactions were for.
//
// The browser sends WHICH transactions, never WHAT they are. The server
// re-scans the client's books and only creates a question for an entry that is
// genuinely still uncoded right now — same rule as the receipt chase, and it
// matters for the same two reasons: a client-supplied description would let a
// crafted request put arbitrary text in front of a client, and a client-supplied
// transaction id would let it wire a future answer onto any entry in the ledger.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { scanUncategorized, uncatKey } from "@/lib/quickbooks/uncategorized";
import {
  createLedgerQuestions,
  LedgerQuestionUnsupportedError,
} from "@/lib/db/ledger-question";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export const runtime = "nodejs";
// A scan queries the ledger four times and the send writes a row per question.
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
  // client check stops one client's transactions being asked about in another
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
    return NextResponse.json(
      {
        error: "engagement_closed",
        detail:
          "That engagement is closed, so the client can't answer on it. Reopen it or pick another.",
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
    scan = await scanUncategorized(ctx, { from, to });
  } catch (err) {
    console.error("[ledger question] scan failed:", err);
    return NextResponse.json(
      { error: "scan_failed", detail: "Couldn't read the client's books." },
      { status: 502 },
    );
  }

  // Intersect: only ask about what the books still say is uncoded. A
  // transaction categorised between the firm loading the page and pressing the
  // button drops out here rather than producing a question with no purpose.
  const wanted = new Set(keys);
  const txns = scan.txns.filter((t) => wanted.has(uncatKey(t.entity, t.qboId)));
  if (txns.length === 0) {
    return NextResponse.json({
      ok: true,
      created: 0,
      skippedDuplicate: 0,
      stale: keys.length,
    });
  }

  try {
    const result = await createLedgerQuestions({ engagementId, txns });
    revalidateAllLocales(`/engagements/${engagementId}`);
    revalidateAllLocales("/quickbooks/uncategorized");
    try {
      await logUserActivity(firm.id, engagementId, "ask_about_transactions", {
        client_id: clientId,
        count: result.created,
      });
    } catch (err) {
      console.error("[ledger question] audit log failed (items created):", err);
    }
    return NextResponse.json({
      ok: true,
      ...result,
      stale: keys.length - txns.length,
    });
  } catch (err) {
    if (err instanceof LedgerQuestionUnsupportedError) {
      return NextResponse.json(
        { error: "migration_required", detail: err.message },
        { status: 409 },
      );
    }
    console.error("[ledger question] create failed:", err);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
