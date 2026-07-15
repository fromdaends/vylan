import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { clearFirmConnectAccount } from "@/lib/db/stripe-connect";

export const runtime = "nodejs";

// POST /api/billing/connect/disconnect
//
// Owner-only. Clears the firm's stored Stripe Connect link so the Payments
// settings return to "not connected" and the firm can reconnect fresh.
//
// This only forgets the connection on VYLAN's side — it does NOT delete or
// deauthorize the accountant's own Stripe account (a Standard account belongs to
// them; they manage/close it in their Stripe dashboard). It is also the fix when
// a Stripe-side disconnect never reached our webhook (e.g. a test-mode
// disconnect that couldn't hit the live webhook), which otherwise leaves Vylan
// stuck showing "connected".
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Owner-only: the connected payout account is firm-admin, same as connecting.
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }
  // Idempotent: nothing to clear is still success, so the UI just refreshes clean.
  if (!firm.stripe_connect_account_id) {
    return NextResponse.json({ ok: true });
  }
  try {
    await clearFirmConnectAccount(firm.id);
  } catch (e) {
    console.error("[connect/disconnect] clear failed:", e);
    return NextResponse.json({ error: "clear_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
