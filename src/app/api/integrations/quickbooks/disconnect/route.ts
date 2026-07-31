import { emitIntegrationEvent } from "@/lib/notifications/emit";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { revokeToken } from "@/lib/quickbooks/client";
import {
  getFirmQuickbooksConnectionWithTokens,
  clearFirmQuickbooksConnection,
} from "@/lib/db/quickbooks";
import { purgeFirmQuickbooksCache } from "@/lib/db/quickbooks-cache";

export const runtime = "nodejs";

// POST /api/integrations/quickbooks/disconnect
//
// Owner-only. Tells Intuit to revoke our access (best-effort), then clears the
// stored connection so the UI returns to "not connected". The body may carry a
// `clientId` to disconnect THAT client's connection (per-client); omitted = the
// firm-level connection. Even if Intuit can't be reached, the local record is
// cleared — the firm is never stuck looking "connected".
export async function POST(request: Request) {
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

  let clientId: string | null = null;
  const body = (await request.json().catch(() => null)) as {
    clientId?: unknown;
  } | null;
  if (body && typeof body.clientId === "string" && body.clientId) {
    clientId = body.clientId;
  }

  // Revoking the refresh token revokes the whole grant at Intuit. Best-effort:
  // we clear our record regardless of whether the revoke call succeeds. The read
  // is firm-scoped, so it only ever returns THIS firm's connection for that client.
  const conn = await getFirmQuickbooksConnectionWithTokens(firm.id, clientId);
  if (conn) {
    await revokeToken(conn.refreshToken);
  }
  await clearFirmQuickbooksConnection(firm.id, clientId);
  // Drop that connection's cached reference lists too: they belong to the
  // disconnected company and are rebuilt by the sync on the next connect. Learned
  // mappings and drafts are kept — reconnecting the SAME company (the common fix
  // for a dead connection) must not lose them; a COMPANY change is handled by the
  // callback's realm comparison.
  await purgeFirmQuickbooksCache(firm.id, clientId);
  // Locked-on event: the owners hear about a lost accounting connection even if
  // they have every other notification switched off. The person who clicked
  // Disconnect is the actor and is not told about their own click.
  await emitIntegrationEvent(sb, {
    firmId: firm.id,
    outcome: "disconnected",
    provider: "QuickBooks",
    actorId: me?.id ?? null,
  });
  return NextResponse.json({ ok: true });
}
