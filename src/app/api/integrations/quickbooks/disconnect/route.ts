import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { revokeToken } from "@/lib/quickbooks/client";
import {
  getFirmQuickbooksConnectionWithTokens,
  clearFirmQuickbooksConnection,
} from "@/lib/db/quickbooks";

export const runtime = "nodejs";

// POST /api/integrations/quickbooks/disconnect
//
// Owner-only. Tells Intuit to revoke our access (best-effort), then clears the
// firm's stored connection so the Settings UI returns to "not connected". Even if
// Intuit can't be reached, the local record is cleared — the firm is never stuck
// looking "connected".
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

  // Revoking the refresh token revokes the whole grant at Intuit. Best-effort:
  // we clear our record regardless of whether the revoke call succeeds.
  const conn = await getFirmQuickbooksConnectionWithTokens(firm.id);
  if (conn) {
    await revokeToken(conn.refreshToken);
  }
  await clearFirmQuickbooksConnection(firm.id);
  return NextResponse.json({ ok: true });
}
