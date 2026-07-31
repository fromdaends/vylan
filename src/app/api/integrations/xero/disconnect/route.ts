import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { disconnectXeroConnection } from "@/lib/xero/client";
import {
  getClientXeroLinkRefs,
  clearClientXeroConnection,
  findXeroTenantIdsInUse,
} from "@/lib/db/xero";
import { purgeXeroCache } from "@/lib/db/xero-cache";
import { getValidXeroAccessToken } from "@/lib/xero/connection";
import { decideXeroLinkRelease } from "@/lib/xero/link-release";

export const runtime = "nodejs";

// POST /api/integrations/xero/disconnect  { clientId }
//
// Owner-only. Releases the org link at Xero (DELETE /connections/{id} —
// deliberately NOT token revocation, which would kill EVERY org this Xero
// user connected, including other clients'), then clears the stored row.
// Best-effort remote-side: even if Xero can't be reached, the local record is
// cleared so the client is never stuck looking "connected".
//
// ORDER MATTERS — the local delete runs BEFORE the in-use check, and that is
// deliberate. Since 0950 a Xero DEMO organisation may back several clients, so
// this route can no longer assume it owns the org link (0740's plain tenant
// unique index used to guarantee that; it is now partial, real orgs only). The
// app↔org link is ONE shared object at Xero, so releasing it while another
// client still points at that org would sever that client too. The guard has to
// ask "does anyone ELSE still use this org?" — and findXeroTenantIdsInUse is
// cross-firm and unfiltered, so asking it while THIS row still exists would
// always answer "yes" and we would never release anything. Deleting first makes
// the question self-correcting: whatever remains is somebody else's.
//
// The trade-off is that a crash between the delete and the release orphans the
// link at Xero (it keeps occupying a free-tier connection slot until manually
// removed). That is the same trade the callback's tenant-switch path already
// takes, and it is the right way round: a leaked link is recoverable, a client
// stuck showing "connected" against a dead connection is not.
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

  const body = (await request.json().catch(() => null)) as {
    clientId?: unknown;
  } | null;
  if (typeof body?.clientId !== "string" || !body.clientId) {
    return NextResponse.json({ error: "no_client" }, { status: 400 });
  }
  const clientId = body.clientId;

  // Firm-scoped read (this firm's row for this client only) — refs ONLY, no
  // token decrypt, so a row whose tokens can't decrypt still yields the link we
  // need to release. Both of these must happen while the row still exists: the
  // remote release needs a LIVE access token (the connections endpoint takes
  // Bearer auth), and a dead/unrefreshable connection just skips the release.
  const refs = await getClientXeroLinkRefs(firm.id, clientId);
  const token = refs?.connectionId
    ? await getValidXeroAccessToken(firm.id, clientId)
    : null;

  await clearClientXeroConnection(firm.id, clientId);

  // Now that this client's row is gone, any row still holding the org is a
  // DIFFERENT client that would be severed by releasing the shared link — so we
  // leave the link alone and only drop it locally. Only reachable for a demo
  // org (real orgs stay one-client-only via the partial unique index).
  // findXeroTenantIdsInUse fails CLOSED — a transient DB error reports every id
  // as in use, so a blip leaks a link rather than severing a live connection.
  if (refs) {
    const decision = decideXeroLinkRelease({
      connectionId: refs.connectionId,
      accessToken: token,
      tenantId: refs.tenantId,
      tenantsStillInUse: await findXeroTenantIdsInUse([refs.tenantId]),
    });
    if (decision.release) {
      await disconnectXeroConnection(
        decision.accessToken,
        decision.connectionId,
      );
    } else if (decision.reason === "shared") {
      console.warn(
        `[xero] keeping org link ${refs.tenantId} — another client still uses it`,
      );
    }
  }
  // Drop this client's cached reference lists — they belong to the disconnected
  // org and are rebuilt by the sync on the next connect (mirrors the QBO
  // disconnect). Best-effort.
  await purgeXeroCache(firm.id, clientId);
  return NextResponse.json({ ok: true });
}
