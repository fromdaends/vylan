import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { clearFirmPayPalConnection } from "@/lib/db/paypal-connect";

export const runtime = "nodejs";

// POST /api/billing/paypal/disconnect
//
// Owner-only. Clears the firm's stored PayPal connection so the Payments
// settings return to "not connected" and no PayPal payment can be attempted.
// Mirrors /api/billing/connect/disconnect: this only forgets the link on
// VYLAN's side — the accountant's own PayPal Business account is theirs; they
// can also revoke Vylan's permissions from inside PayPal (which the Phase 4
// consent-revoked webhook will pick up).
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }
  // Idempotent: nothing to clear is still success.
  const merchantId =
    (firm as { paypal_merchant_id?: string | null }).paypal_merchant_id ?? null;
  if (!merchantId) {
    return NextResponse.json({ ok: true });
  }
  try {
    await clearFirmPayPalConnection(firm.id);
  } catch (e) {
    console.error("[paypal/disconnect] clear failed:", e);
    return NextResponse.json({ error: "clear_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
