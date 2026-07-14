// Client messaging, portal side (Phase 2): stamp "the client has seen the
// thread as of now", POST {token}. Called when the client opens the Messages
// view. No-op when no thread exists yet. Complete engagements still stamp —
// reading history is always allowed; only WRITING is status-gated.

import { NextResponse, type NextRequest } from "next/server";
import { findEngagementForToken } from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  markThreadReadByClient,
} from "@/lib/db/client-messages";
import { checkRateLimit, PORTAL_MUTATION_PER_TOKEN } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  if (typeof token !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const rl = await checkRateLimit({
    key: `portal:mutation:token:${token}`,
    ...PORTAL_MUTATION_PER_TOKEN,
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

  const res = await markThreadReadByClient(
    getServiceRoleSupabase(),
    engagement.id,
  );
  if (res === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
