// Client messaging (Phase 1) — the human accountant<->client thread, one per
// engagement. NOT the AI assistant chat (that's engagement-chat/db.ts): the
// two features share zero tables and zero components on purpose.
//
// Firm-side helpers here run on the caller's RLS-scoped session client, so
// firm isolation is enforced by the database, not by this code. Client-side
// (portal) access ships in Phase 2 and goes through the service role after
// magic-token validation — the client never touches these tables directly.
//
// GATED on migration 0650: every reader/writer treats a missing table as
// "messaging not activated yet" (returns the sentinel) instead of throwing,
// so the code can deploy before the SQL is applied — the repo's tiered
// pattern (same as engagement-chat on 0550).

import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientMessageSender = "firm" | "client";

export type ClientMessageRow = {
  id: string;
  sender: ClientMessageSender;
  sender_user_id: string | null;
  sender_name: string;
  body: string;
  created_at: string;
};

export type ClientMessageThreadRow = {
  id: string;
  firm_last_read_at: string | null;
  client_last_read_at: string | null;
  client_last_notified_at: string | null;
};

// Server-side cap, mirrored by the DB check constraint and the composer.
export const CLIENT_MESSAGE_MAX_LENGTH = 4000;

// How many messages the thread loads. Oldest are dropped first; at comment
// cadence (a few per engagement) nobody should ever hit this.
export const CLIENT_MESSAGE_PAGE_SIZE = 500;

// Sentinel for "migration 0650 not applied on this environment".
export const CLIENT_MESSAGING_SCHEMA_MISSING = Symbol(
  "client-messaging-schema-missing",
);
export type MessagingSchemaMissing = typeof CLIENT_MESSAGING_SCHEMA_MISSING;

// PostgREST reports a missing TABLE as PGRST205 (schema-cache miss on the
// relation); Postgres proper reports undefined_table 42P01. Missing-column
// codes (PGRST204 / 42703) are included for safety during partial applies.
// Match on codes ONLY, never message text (same rule as engagement-chat).
export function isClientMessagingSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

// PURE: how many of `messages` are unread for the firm — client messages
// newer than the firm's last-read stamp. Exported for unit tests and shared
// by the page (initial badge) and the API (refresh).
export function countUnreadForFirm(
  messages: Pick<ClientMessageRow, "sender" | "created_at">[],
  firmLastReadAt: string | null,
): number {
  const cutoff = firmLastReadAt ? new Date(firmLastReadAt).getTime() : 0;
  return messages.filter(
    (m) => m.sender === "client" && new Date(m.created_at).getTime() > cutoff,
  ).length;
}

// PURE: the mirror image — how many FIRM messages the client hasn't seen.
// Powers the "new message" hint on the portal's Messages entry.
export function countUnreadForClient(
  messages: Pick<ClientMessageRow, "sender" | "created_at">[],
  clientLastReadAt: string | null,
): number {
  const cutoff = clientLastReadAt ? new Date(clientLastReadAt).getTime() : 0;
  return messages.filter(
    (m) => m.sender === "firm" && new Date(m.created_at).getTime() > cutoff,
  ).length;
}

// The client-safe projection of a message: everything the portal needs and
// nothing else (no internal user ids). What the portal context + the portal
// list route both return.
export type PortalMessage = Omit<ClientMessageRow, "sender_user_id">;

export function toPortalMessage(m: ClientMessageRow): PortalMessage {
  return {
    id: m.id,
    sender: m.sender,
    sender_name: m.sender_name,
    body: m.body,
    created_at: m.created_at,
  };
}

// The engagement's thread state row, or null when no thread exists yet (no
// messages ever sent), or the sentinel pre-migration. RLS scopes to the
// caller's firm.
export async function getThreadForEngagement(
  sb: SupabaseClient,
  engagementId: string,
): Promise<ClientMessageThreadRow | null | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .select(
      "id, firm_last_read_at, client_last_read_at, client_last_notified_at",
    )
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return (res.data as ClientMessageThreadRow | null) ?? null;
}

// Get-or-create the engagement's thread row, returning its id. Handles the
// unique(engagement_id) race with a teammate's first message by re-reading.
export async function getOrCreateThread(
  sb: SupabaseClient,
  firmId: string,
  engagementId: string,
): Promise<string | MessagingSchemaMissing> {
  const existing = await sb
    .from("client_message_threads")
    .select("id")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (existing.error) {
    if (isClientMessagingSchemaMissing(existing.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw existing.error;
  }
  if (existing.data) return (existing.data as { id: string }).id;

  const inserted = await sb
    .from("client_message_threads")
    .insert({ firm_id: firmId, engagement_id: engagementId })
    .select("id")
    .maybeSingle();
  if (inserted.error) {
    if (isClientMessagingSchemaMissing(inserted.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    if (inserted.error.code === "23505") {
      const reread = await sb
        .from("client_message_threads")
        .select("id")
        .eq("engagement_id", engagementId)
        .maybeSingle();
      if (reread.error) throw reread.error;
      const id = (reread.data as { id: string } | null)?.id;
      if (id) return id;
    }
    throw inserted.error;
  }
  const id = (inserted.data as { id: string } | null)?.id;
  if (!id) throw new Error("thread_create_failed");
  return id;
}

// The thread's messages, oldest first (fetch newest-first for the LIMIT,
// then reverse so callers render in order).
export async function listClientMessages(
  sb: SupabaseClient,
  engagementId: string,
): Promise<ClientMessageRow[] | MessagingSchemaMissing> {
  const res = await sb
    .from("client_messages")
    .select("id, sender, sender_user_id, sender_name, body, created_at")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(CLIENT_MESSAGE_PAGE_SIZE);
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return ((res.data ?? []) as ClientMessageRow[]).reverse();
}

// Insert a firm-authored message. The RLS insert policy enforces sender =
// 'firm' + self-authorship; this helper just shapes the row. Returns the
// inserted row so the composer can append it without a refetch.
export async function insertFirmMessage(
  sb: SupabaseClient,
  row: {
    firmId: string;
    engagementId: string;
    userId: string;
    senderName: string;
    body: string;
  },
): Promise<ClientMessageRow | MessagingSchemaMissing> {
  const res = await sb
    .from("client_messages")
    .insert({
      firm_id: row.firmId,
      engagement_id: row.engagementId,
      sender: "firm",
      sender_user_id: row.userId,
      sender_name: row.senderName,
      body: row.body,
    })
    .select("id, sender, sender_user_id, sender_name, body, created_at")
    .single();
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return res.data as ClientMessageRow;
}

// Insert a client-authored message. SERVICE ROLE ONLY (Phase 2): called by
// the /api/portal/messages routes after magic-token validation — the RLS
// insert policy deliberately refuses sender='client' from any authenticated
// session, so this cannot run on a session client.
export async function insertClientMessage(
  sb: SupabaseClient,
  row: {
    firmId: string;
    engagementId: string;
    senderName: string;
    body: string;
  },
): Promise<ClientMessageRow | MessagingSchemaMissing> {
  const res = await sb
    .from("client_messages")
    .insert({
      firm_id: row.firmId,
      engagement_id: row.engagementId,
      sender: "client",
      sender_user_id: null,
      sender_name: row.senderName,
      body: row.body,
    })
    .select("id, sender, sender_user_id, sender_name, body, created_at")
    .single();
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return res.data as ClientMessageRow;
}

// Stamp "the client has seen the thread as of now". SERVICE ROLE ONLY (the
// column grant excludes client_last_read_at from authenticated sessions).
// No-op (false) when the thread doesn't exist yet — nothing to mark.
export async function markThreadReadByClient(
  sb: SupabaseClient,
  engagementId: string,
): Promise<boolean | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .update({ client_last_read_at: new Date().toISOString() })
    .eq("engagement_id", engagementId)
    .select("id");
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return (res.data ?? []).length > 0;
}

// Stamp "the client was emailed about firm messages up to `at`". SERVICE
// ROLE ONLY (job worker). The watermark is what makes the notify job
// idempotent: a rerun sees nothing newer than the stamp and skips.
export async function markClientNotified(
  sb: SupabaseClient,
  engagementId: string,
  at: string,
): Promise<boolean | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .update({ client_last_notified_at: at })
    .eq("engagement_id", engagementId)
    .select("id");
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return (res.data ?? []).length > 0;
}

// Stamp "the firm has seen the thread as of now". No-op (false) when the
// thread doesn't exist yet — nothing to mark. The column grant (0650)
// whitelists firm_last_read_at only.
export async function markThreadReadByFirm(
  sb: SupabaseClient,
  engagementId: string,
): Promise<boolean | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .update({ firm_last_read_at: new Date().toISOString() })
    .eq("engagement_id", engagementId)
    .select("id");
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return (res.data ?? []).length > 0;
}

// ---------------------------------------------------------------------------
// Firm inbox — the accountant's social-style, cross-client conversation list.
// ---------------------------------------------------------------------------

// One row in the accountant's message inbox: an engagement's thread summarized
// for the list (client + engagement identity, the last-message preview, and how
// many client messages the firm hasn't read).
export type FirmConversation = {
  engagementId: string;
  engagementTitle: string;
  clientName: string | null;
  // Engagement status — drives the read-only composer, and which rows can start
  // a fresh conversation (live) vs. only show history.
  status: string;
  lastMessage: {
    body: string;
    sender: ClientMessageSender;
    createdAt: string;
  } | null;
  // Client messages newer than the firm's read stamp for this thread.
  unreadCount: number;
  // Sort key: the last message's time, or the engagement's own timestamp when
  // nothing has been exchanged yet.
  lastActivityAt: string;
};

// Engagement statuses that can start/continue a conversation. Mirrors the API
// route's WRITABLE_STATUSES; complete/cancelled threads stay visible (history)
// but read-only.
const CONVERSATION_LIVE_STATUSES = new Set(["sent", "in_progress"]);

// PURE: fold the three raw result sets — active-scope engagements, threads, and
// messages (newest-first) — into the sorted inbox. Exported for unit tests.
//
// An engagement earns a row when it's live (messageable now) OR it already has
// a thread (history to show); draft/other engagements without a thread are left
// out. Rows sort by most recent activity, so live-but-silent engagements fall
// below the ones with real messages.
export function buildFirmConversations(
  engagements: {
    id: string;
    title: string;
    status: string;
    clientName: string | null;
    createdAt: string;
  }[],
  threads: { engagement_id: string; firm_last_read_at: string | null }[],
  // Newest-first, as the DB returns them.
  messages: {
    engagement_id: string;
    sender: ClientMessageSender;
    body: string;
    created_at: string;
  }[],
): FirmConversation[] {
  const readAtByEng = new Map<string, string | null>();
  for (const t of threads)
    readAtByEng.set(t.engagement_id, t.firm_last_read_at);

  const lastByEng = new Map<
    string,
    { body: string; sender: ClientMessageSender; createdAt: string }
  >();
  const unreadByEng = new Map<string, number>();
  for (const m of messages) {
    // Newest-first, so the first one seen per engagement is its last message.
    if (!lastByEng.has(m.engagement_id)) {
      lastByEng.set(m.engagement_id, {
        body: m.body,
        sender: m.sender,
        createdAt: m.created_at,
      });
    }
    if (m.sender === "client") {
      const cutoff = readAtByEng.get(m.engagement_id) ?? null;
      const cutoffMs = cutoff ? new Date(cutoff).getTime() : 0;
      if (new Date(m.created_at).getTime() > cutoffMs) {
        unreadByEng.set(
          m.engagement_id,
          (unreadByEng.get(m.engagement_id) ?? 0) + 1,
        );
      }
    }
  }

  const rows: FirmConversation[] = [];
  for (const e of engagements) {
    const hasThread = readAtByEng.has(e.id);
    if (!hasThread && !CONVERSATION_LIVE_STATUSES.has(e.status)) continue;
    const last = lastByEng.get(e.id) ?? null;
    rows.push({
      engagementId: e.id,
      engagementTitle: e.title,
      clientName: e.clientName,
      status: e.status,
      lastMessage: last,
      unreadCount: unreadByEng.get(e.id) ?? 0,
      lastActivityAt: last?.createdAt ?? e.createdAt,
    });
  }

  rows.sort(
    (a, b) =>
      new Date(b.lastActivityAt).getTime() -
      new Date(a.lastActivityAt).getTime(),
  );
  return rows;
}

// Load the accountant's cross-client inbox on their RLS-scoped session client.
// Three cheap reads (threads, active-scope engagements, recent messages) folded
// by buildFirmConversations — no SQL view/RPC, so nothing to migrate.
export async function listFirmConversations(
  sb: SupabaseClient,
): Promise<FirmConversation[] | MessagingSchemaMissing> {
  // Threads (one per engagement that's ever had a message) + the firm read
  // stamp. RLS scopes to the caller's firm.
  const threadsRes = await sb
    .from("client_message_threads")
    .select("engagement_id, firm_last_read_at");
  if (threadsRes.error) {
    if (isClientMessagingSchemaMissing(threadsRes.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw threadsRes.error;
  }
  const threads = (threadsRes.data ?? []) as {
    engagement_id: string;
    firm_last_read_at: string | null;
  }[];

  // Active-scope engagements (same lifecycle scope as the board/selector) with
  // the client display name.
  const engRes = await sb
    .from("engagements")
    .select("id, title, status, created_at, clients(display_name)")
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (engRes.error) throw engRes.error;
  type EngRow = {
    id: string;
    title: string;
    status: string;
    created_at: string;
    clients: { display_name: string | null } | null;
  };
  const engagements = ((engRes.data ?? []) as unknown as EngRow[]).map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    clientName: e.clients?.display_name ?? null,
    createdAt: e.created_at,
  }));

  // Only pull messages for engagements we'll actually show (threaded or live).
  const threadEngIds = new Set(threads.map((t) => t.engagement_id));
  const relevantIds = engagements
    .filter(
      (e) => threadEngIds.has(e.id) || CONVERSATION_LIVE_STATUSES.has(e.status),
    )
    .map((e) => e.id);
  if (relevantIds.length === 0) return [];

  // Recent messages, newest-first; grouped in memory for last-message + unread.
  // Comment-cadence volume; the cap only bounds a very chatty firm.
  const msgRes = await sb
    .from("client_messages")
    .select("engagement_id, sender, body, created_at")
    .in("engagement_id", relevantIds)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (msgRes.error) {
    if (isClientMessagingSchemaMissing(msgRes.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw msgRes.error;
  }
  const messages = (msgRes.data ?? []) as {
    engagement_id: string;
    sender: ClientMessageSender;
    body: string;
    created_at: string;
  }[];

  return buildFirmConversations(engagements, threads, messages);
}
