import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { disconnectXeroConnection } from "@/lib/xero/client";
import {
  readClientXeroConnection,
  clearClientXeroConnection,
} from "@/lib/db/xero";
import { getValidXeroAccessToken } from "@/lib/xero/connection";

export const runtime = "nodejs";

// POST /api/integrations/xero/disconnect  { clientId }
//
// Owner-only. Releases the org link at Xero (DELETE /connections/{id} —
// deliberately NOT token revocation, which would kill EVERY org this Xero
// user connected, including other clients'), then clears the stored row.
// Best-effort remote-side: even if Xero can't be reached, the local record is
// cleared so the client is never stuck looking "connected". The tenant unique
// index guarantees exactly one row references this org, so releasing the link
// can't sever anyone else.
export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => null)) as {
    clientId?: unknown;
  } | null;
  if (typeof body?.clientId !== "string" || !body.clientId) {
    return NextResponse.json({ error: "no_client" }, { status: 400 });
  }
  const clientId = body.clientId;

  // Firm-scoped read (this firm's row for this client only). Best-effort
  // remote release needs a LIVE access token (the connections endpoint takes
  // Bearer auth); a dead/unrefreshable connection skips straight to the local
  // clear.
  const read = await readClientXeroConnection(firm.id, clientId);
  if (read.kind === "ok" && read.conn.connectionId) {
    const token = await getValidXeroAccessToken(firm.id, clientId);
    if (token) {
      await disconnectXeroConnection(token, read.conn.connectionId);
    }
  }
  await clearClientXeroConnection(firm.id, clientId);
  return NextResponse.json({ ok: true });
}
