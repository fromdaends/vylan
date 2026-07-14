// Client messaging, portal side (Phase 2): the client sends a message,
// POST {token, body}.
//
// Safety on the unauthenticated write path:
//   * magic token -> exactly one engagement (shape + expiry + not cancelled)
//   * rate-limited per token (same budget as the other portal mutations)
//   * body length capped (mirrors the DB check constraint)
//   * refused on complete engagements (read-only after completion) — the
//     server-side backstop behind the disabled composer
//   * TEXT ONLY by design: no attachment fields exist anywhere in this flow.

import { NextResponse, type NextRequest } from "next/server";
import { findEngagementForToken, logActivity } from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  CLIENT_MESSAGE_MAX_LENGTH,
  CLIENT_MESSAGING_SCHEMA_MISSING,
  getOrCreateThread,
  insertClientMessage,
  markThreadReadByClient,
  toPortalMessage,
} from "@/lib/db/client-messages";
import { checkRateLimit, PORTAL_MUTATION_PER_TOKEN } from "@/lib/rate-limit";
import { scheduleFirmMessageNotification } from "@/lib/client-messages-notify";

export const runtime = "nodejs";

// Statuses that accept a client message (mirrors the firm-side route).
const WRITABLE_STATUSES = new Set(["sent", "in_progress"]);

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const token = json?.token;
  const body = typeof json?.body === "string" ? json.body.trim() : "";
  if (typeof token !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (body.length === 0 || body.length > CLIENT_MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
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
  if (!WRITABLE_STATUSES.has(engagement.status)) {
    return NextResponse.json({ error: "read_only" }, { status: 400 });
  }

  const sb = getServiceRoleSupabase();
  // Sender name shown in the thread: the client's display name on file.
  const { data: client } = await sb
    .from("clients")
    .select("display_name")
    .eq("id", engagement.client_id)
    .maybeSingle();
  const senderName =
    (client?.display_name as string | undefined)?.trim() || "Client";

  const threadId = await getOrCreateThread(sb, engagement.firm_id, engagement.id);
  if (threadId === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }

  const message = await insertClientMessage(sb, {
    firmId: engagement.firm_id,
    engagementId: engagement.id,
    senderName,
    body,
  });
  if (message === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }

  // Replying implies the client has seen the thread; log the event for the
  // accountant's activity feed; then (re)start the debounced accountant-email
  // timer (one email per burst of replies). All best-effort — never fail an
  // already-written send.
  try {
    await markThreadReadByClient(sb, engagement.id);
    await logActivity(engagement.firm_id, engagement.id, "client_message_sent", {
      message_id: message.id,
    });
  } catch (e) {
    console.error("[portal messages] post-send bookkeeping failed:", e);
  }
  try {
    await scheduleFirmMessageNotification(engagement.id);
  } catch (e) {
    console.error("[portal messages] notify scheduling failed:", e);
  }

  return NextResponse.json({ ok: true, message: toPortalMessage(message) });
}
