// Client messaging, portal side: the thread refresh, POST {token}.
//
// Trust model (same as every portal route): the client's browser never
// touches the database. The magic token resolves to exactly ONE engagement
// (or the request is refused), and that engagement resolves to exactly ONE
// client — the read runs on the service role scoped by that client id. The
// client cannot name a client or an engagement themselves.
//
// Since 1440 this returns the client's WHOLE conversation with the firm, not
// just the part that happened under the engagement whose link they opened.

import { NextResponse, type NextRequest } from "next/server";
import { findEngagementForToken } from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  countUnreadForClient,
  getThreadForClient,
  listClientMessages,
  toPortalMessage,
} from "@/lib/db/client-messages";
import { checkRateLimit, PORTAL_STATUS_PER_TOKEN } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  if (typeof token !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const rl = await checkRateLimit({
    key: `portal:messages:list:${token}`,
    ...PORTAL_STATUS_PER_TOKEN,
  });
  if (!rl.ok) {
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (rl.retryAfter) res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }

  const engagement = await findEngagementForToken(token);
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const sb = getServiceRoleSupabase();
  const [messages, thread] = await Promise.all([
    listClientMessages(sb, engagement.client_id),
    getThreadForClient(sb, engagement.client_id),
  ]);
  if (
    messages === CLIENT_MESSAGING_SCHEMA_MISSING ||
    thread === CLIENT_MESSAGING_SCHEMA_MISSING
  ) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }

  return NextResponse.json({
    messages: messages.map(toPortalMessage),
    unread: countUnreadForClient(
      messages,
      thread?.client_last_read_at ?? null,
    ),
  });
}
