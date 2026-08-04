// Client messaging, portal side: the client sends a message, POST {token, body}.
//
// The portal is the client's ONLY way into the conversation (founder rule), and
// since 1440 the conversation is the CLIENT's forever thread — so whichever
// engagement's link they happen to be holding, the message lands in the same
// one place. The token still decides IF they may write; it no longer decides
// WHERE the message goes.
//
// Safety on the unauthenticated write path:
//   * magic token -> exactly one engagement (shape + PIN + expiry + not
//     cancelled), which resolves to exactly one client
//   * rate-limited per token (same budget as the other portal mutations)
//   * body length capped (mirrors the DB check constraint)
//   * TEXT ONLY by design: no attachment fields exist anywhere in this flow.
//
// NO LONGER refused on complete engagements (founder ruling, 2026-08-05): the
// thread isn't about the engagement any more, so finishing one must not mute
// the client — including on a reply to a message the firm just sent them. A
// cancelled or expired link is still the off switch, enforced upstream in
// findEngagementForToken.

import { notify } from "@/lib/notifications/notify";
import { clientName } from "@/lib/notifications/emit";
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

  const sb = getServiceRoleSupabase();
  // Sender name shown in the thread: the client's display name on file.
  const { data: client } = await sb
    .from("clients")
    .select("display_name")
    .eq("id", engagement.client_id)
    .maybeSingle();
  const senderName =
    (client?.display_name as string | undefined)?.trim() || "Client";

  const threadId = await getOrCreateThread(
    sb,
    engagement.firm_id,
    engagement.client_id,
  );
  if (threadId === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }

  const message = await insertClientMessage(sb, {
    firmId: engagement.firm_id,
    clientId: engagement.client_id,
    // Provenance only: which portal they were standing in when they wrote.
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
    await markThreadReadByClient(sb, engagement.client_id);
    await logActivity(engagement.firm_id, engagement.id, "client_message_sent", {
      message_id: message.id,
    });
  } catch (e) {
    console.error("[portal messages] post-send bookkeeping failed:", e);
  }
  try {
    await scheduleFirmMessageNotification(engagement.client_id);
  } catch (e) {
    console.error("[portal messages] notify scheduling failed:", e);
  }
  // In-app notification for the firm. suppressEmail because
  // scheduleFirmMessageNotification above already owns the EMAIL for this
  // event, debounced so a burst of client replies is one email rather than
  // one per message. The per-event Email switch governs that job via
  // wantsEmailFor, so the setting is still real.
  await notify({
    firmId: engagement.firm_id,
    eventKey: "message.client_replied",
    entity: { type: "engagement", id: engagement.id },
    engagementId: engagement.id,
    clientId: engagement.client_id,
    suppressEmail: true,
    payload: {
      // The portal's engagement row is a narrow projection without the title;
      // the feed falls back to the client name, which is the more useful line
      // here anyway.
      engagement_title: null,
      client_name: await clientName(sb, engagement.client_id),
      count: 1,
      href: `/engagements/${engagement.id}?panel=messages`,
    },
  });

  return NextResponse.json({ ok: true, message: toPortalMessage(message) });
}
