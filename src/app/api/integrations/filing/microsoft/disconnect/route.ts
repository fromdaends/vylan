import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { disconnectFirmStorageConnection } from "@/lib/db/filing";

export const runtime = "nodejs";

// POST /api/integrations/filing/microsoft/disconnect
//
// Owner-only. Clears the stored tokens and flips the connection row to
// 'disconnected'; the row is KEPT so the filed-documents ledger stays
// attached (a later reconnect revives the same row — nothing ever files
// twice). Microsoft's identity platform has no self-serve token-revocation
// endpoint like Google's, so the cleared tokens simply age out; the user can
// additionally remove "Vylan" under myaccount.microsoft.com app permissions.
// Nothing already filed in the firm's storage is touched, ever.
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

  const result = await disconnectFirmStorageConnection(firm.id);
  if (!result) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
