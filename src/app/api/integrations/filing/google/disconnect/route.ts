import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { disconnectFirmStorageConnection } from "@/lib/db/filing";
import { revokeGoogleToken } from "@/lib/filing/google/oauth";

export const runtime = "nodejs";

// POST /api/integrations/filing/google/disconnect
//
// Owner-only. Revokes the Google grant (best effort), clears the stored
// tokens, and flips the connection row to 'disconnected' — the row is KEPT so
// the filed-documents ledger stays attached (a later reconnect revives the
// same row, so nothing ever files twice). Nothing already filed in the firm's
// Drive is touched, ever.
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (!can(me, "integrations.manage")) {
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
  // Revoke AFTER the row is safely disconnected; revoking the refresh token
  // kills the whole grant on Google's side.
  if (result.refreshToken) {
    await revokeGoogleToken(result.refreshToken);
  }
  return NextResponse.json({ ok: true });
}
