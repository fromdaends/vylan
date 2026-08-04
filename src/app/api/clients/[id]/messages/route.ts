// Client messaging, accountant side.
//   GET  /api/clients/[id]/messages — the thread + unread count (poll)
//   POST /api/clients/[id]/messages — send a firm message
//
// The client's ONE forever conversation (migration 1440). There is no
// engagement in this path and no status gate on it: the founder's rule is that
// the accountant can write to a client at any time, whatever state their work
// is in. The client's side is gated instead — they can only reply through a
// live portal link.
//
// API routes (not server actions) for the same reason as the add-item route:
// stable URLs across redeploys. Auth + firm scoping are enforced by RLS —
// getServerSupabase carries the accountant's session, and every read/write on
// the messaging tables is policy-checked against current_firm_id(), so a
// foreign client id simply yields an empty thread / a refused insert.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import {
  CLIENT_MESSAGE_MAX_LENGTH,
  CLIENT_MESSAGING_SCHEMA_MISSING,
  countUnreadForFirm,
  getOrCreateThread,
  getThreadForClient,
  insertFirmMessage,
  listClientMessages,
  markThreadReadByFirm,
} from "@/lib/db/client-messages";
import { scheduleClientMessageNotification } from "@/lib/client-messages-notify";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const [messages, thread] = await Promise.all([
    listClientMessages(supabase, id),
    getThreadForClient(supabase, id),
  ]);
  if (
    messages === CLIENT_MESSAGING_SCHEMA_MISSING ||
    thread === CLIENT_MESSAGING_SCHEMA_MISSING
  ) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }
  return NextResponse.json({
    messages,
    unread: countUnreadForFirm(messages, thread?.firm_last_read_at ?? null),
    // For the accountant-side-only "Seen" indicator. The CLIENT is never
    // shown the firm's read state (spec rule) — this only flows firm-ward.
    clientLastReadAt: thread?.client_last_read_at ?? null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const json = (await request.json().catch(() => null)) as {
    body?: unknown;
  } | null;
  const body = typeof json?.body === "string" ? json.body.trim() : "";
  if (body.length === 0 || body.length > CLIENT_MESSAGE_MAX_LENGTH) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // The client read runs under RLS, so a foreign id 404s here — the client id
  // can never widen access beyond the caller's firm. An ARCHIVED client is
  // refused: archiving takes them off the board, and the inbox already drops
  // their conversation, so accepting a write would strand the message
  // somewhere nobody can see it.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (client.archived_at) {
    return NextResponse.json({ error: "archived" }, { status: 400 });
  }

  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm || !user) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const threadId = await getOrCreateThread(supabase, firm.id, id);
  if (threadId === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }

  const message = await insertFirmMessage(supabase, {
    firmId: firm.id,
    clientId: id,
    userId: user.id,
    senderName: userDisplayLabel(user),
    body,
  });
  if (message === CLIENT_MESSAGING_SCHEMA_MISSING) {
    return NextResponse.json({ error: "not_ready" }, { status: 503 });
  }

  // Sending implies you've seen the thread — clear your own unread state so
  // your reply doesn't leave a stale badge. Then (re)start the debounced
  // client-email timer: a burst of sends keeps pushing it back, producing
  // ONE email. Both best-effort; never fail an already-written send.
  try {
    await markThreadReadByFirm(supabase, id);
  } catch (e) {
    console.error("[client-messages] read-stamp after send failed:", e);
  }
  try {
    await scheduleClientMessageNotification(id);
  } catch (e) {
    console.error("[client-messages] notify scheduling failed:", e);
  }

  return NextResponse.json({ ok: true, message });
}
