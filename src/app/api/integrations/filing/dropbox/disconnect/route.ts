import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { disconnectFirmStorageConnection } from "@/lib/db/filing";
import { revokeDropboxToken } from "@/lib/filing/dropbox/oauth";
import { acquireDropboxConnectorContext } from "@/lib/filing/dropbox/connection";

export const runtime = "nodejs";

// POST /api/integrations/filing/dropbox/disconnect — owner-only. Revokes the
// grant (best effort; Dropbox revocation takes a LIVE access token, so one is
// acquired before the row is cleared), keeps the row for ledger continuity.
// Nothing already filed in the firm's Dropbox is touched, ever.
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

  const acquired = await acquireDropboxConnectorContext(firm.id);

  const result = await disconnectFirmStorageConnection(firm.id);
  if (!result) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }
  if (acquired.kind === "ok") {
    await revokeDropboxToken(acquired.ctx.accessToken);
  }
  return NextResponse.json({ ok: true });
}
