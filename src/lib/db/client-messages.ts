// Client messaging — the human accountant<->client thread, ONE PER CLIENT and
// permanent. NOT the AI assistant chat (that's engagement-chat/db.ts): the two
// features share zero tables and zero components on purpose.
//
// The thread used to be keyed on the engagement (0650), which gave a client
// with three engagements three separate conversations, each going read-only
// when its engagement completed. Migration 1440 re-keys it on the CLIENT:
// one forever chat, no engagement framing, no status gate on the firm side.
// Messages still carry engagement_id as provenance (which portal the client
// was standing in), but nothing scopes on it any more.
//
// Firm-side helpers here run on the caller's RLS-scoped session client, so
// firm isolation is enforced by the database, not by this code. The client
// never touches these tables directly: the portal's /api/portal/messages
// routes validate the magic token, resolve it to a client, and read/write via
// the service role.
//
// GATED on migrations 0650 + 1440: every reader/writer treats a missing table
// OR a missing column as "messaging not activated yet" (returns the sentinel)
// instead of throwing, so the code can deploy before the SQL is applied — the
// repo's tiered pattern (same as engagement-chat on 0550).

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

// How many messages the thread loads. Oldest are dropped first. Raised from
// 500 with 1440: this is now a conversation that runs for the life of the
// client relationship rather than the life of one engagement, so the ceiling
// has to be years of chat, not months.
export const CLIENT_MESSAGE_PAGE_SIZE = 1000;

// Sentinel for "the messaging migrations aren't applied on this environment".
export const CLIENT_MESSAGING_SCHEMA_MISSING = Symbol(
  "client-messaging-schema-missing",
);
export type MessagingSchemaMissing = typeof CLIENT_MESSAGING_SCHEMA_MISSING;

// PostgREST reports a missing TABLE as PGRST205 (schema-cache miss on the
// relation); Postgres proper reports undefined_table 42P01. The missing-COLUMN
// codes (PGRST204 / 42703) are what cover the 1440 window specifically — every
// query below names client_id, so an unapplied 1440 lands here and degrades to
// "not activated" instead of erroring. Match on codes ONLY, never message text
// (same rule as engagement-chat).
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

// The client's thread state row, or null when no thread exists yet (nothing
// ever sent), or the sentinel pre-migration. RLS scopes to the caller's firm.
export async function getThreadForClient(
  sb: SupabaseClient,
  clientId: string,
): Promise<ClientMessageThreadRow | null | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .select(
      "id, firm_last_read_at, client_last_read_at, client_last_notified_at",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (res.error) {
    if (isClientMessagingSchemaMissing(res.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw res.error;
  }
  return (res.data as ClientMessageThreadRow | null) ?? null;
}

// Get-or-create the client's thread row, returning its id. Handles the
// unique(client_id) race with a teammate's first message by re-reading.
export async function getOrCreateThread(
  sb: SupabaseClient,
  firmId: string,
  clientId: string,
): Promise<string | MessagingSchemaMissing> {
  const existing = await sb
    .from("client_message_threads")
    .select("id")
    .eq("client_id", clientId)
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
    .insert({ firm_id: firmId, client_id: clientId })
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
        .eq("client_id", clientId)
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

// The client's whole conversation, oldest first (fetch newest-first for the
// LIMIT, then reverse so callers render in order). Spans every engagement the
// client has ever had — that is the point of 1440.
export async function listClientMessages(
  sb: SupabaseClient,
  clientId: string,
): Promise<ClientMessageRow[] | MessagingSchemaMissing> {
  const res = await sb
    .from("client_messages")
    .select("id, sender, sender_user_id, sender_name, body, created_at")
    .eq("client_id", clientId)
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
//
// engagementId is optional and PROVENANCE ONLY — nothing reads it for scoping.
// The accountant writes from the client inbox, which has no engagement, so it
// is normally null.
export async function insertFirmMessage(
  sb: SupabaseClient,
  row: {
    firmId: string;
    clientId: string;
    engagementId?: string | null;
    userId: string;
    senderName: string;
    body: string;
  },
): Promise<ClientMessageRow | MessagingSchemaMissing> {
  const res = await sb
    .from("client_messages")
    .insert({
      firm_id: row.firmId,
      client_id: row.clientId,
      engagement_id: row.engagementId ?? null,
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

// Insert a client-authored message. SERVICE ROLE ONLY: called by the
// /api/portal/messages routes after magic-token validation — the RLS insert
// policy deliberately refuses sender='client' from any authenticated session,
// so this cannot run on a session client.
//
// engagementId records WHICH portal they wrote from; it does not scope the
// message, which lands in the client's one thread either way.
export async function insertClientMessage(
  sb: SupabaseClient,
  row: {
    firmId: string;
    clientId: string;
    engagementId?: string | null;
    senderName: string;
    body: string;
  },
): Promise<ClientMessageRow | MessagingSchemaMissing> {
  const res = await sb
    .from("client_messages")
    .insert({
      firm_id: row.firmId,
      client_id: row.clientId,
      engagement_id: row.engagementId ?? null,
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
  clientId: string,
): Promise<boolean | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .update({ client_last_read_at: new Date().toISOString() })
    .eq("client_id", clientId)
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
  clientId: string,
  at: string,
): Promise<boolean | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .update({ client_last_notified_at: at })
    .eq("client_id", clientId)
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
  clientId: string,
): Promise<boolean | MessagingSchemaMissing> {
  const res = await sb
    .from("client_message_threads")
    .update({ firm_last_read_at: new Date().toISOString() })
    .eq("client_id", clientId)
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

// One row in the accountant's message inbox: a CLIENT's forever thread
// summarized for the list (who it's with, the last-message preview, and how
// many of their messages the firm hasn't read).
export type FirmConversation = {
  clientId: string;
  clientName: string;
  lastMessage: {
    body: string;
    sender: ClientMessageSender;
    createdAt: string;
  } | null;
  // Client messages newer than the firm's read stamp for this thread.
  unreadCount: number;
  // The last message's time, or null when nothing has ever been exchanged —
  // the row shows no timestamp rather than a misleading "created 3 months ago".
  lastActivityAt: string | null;
};

// PURE: fold the three raw result sets — the firm's active clients, threads,
// and messages (newest-first) — into the sorted inbox. Exported for unit tests.
//
// EVERY ACTIVE CLIENT GETS A ROW (founder ruling): the inbox reads like a
// contacts list, so you can start a chat with anyone without hunting for them
// first. Archived clients are excluded entirely, history included — archiving
// is the "off the board" action, and before 1440 this was a live bug (the old
// version filtered on the ENGAGEMENT's flags, which archiving a client never
// sets, so archived clients' conversations kept feeding the unread badge).
//
// Sort: real conversations first, newest activity at the top; then the silent
// clients alphabetically. Recency is meaningless for a client you have never
// messaged, and putting "created most recently" up there pushes live threads
// down for no reason.
export function buildFirmConversations(
  clients: {
    id: string;
    displayName: string;
    archivedAt?: string | null;
  }[],
  threads: { client_id: string; firm_last_read_at: string | null }[],
  // Newest-first, as the DB returns them.
  messages: {
    client_id: string;
    sender: ClientMessageSender;
    body: string;
    created_at: string;
  }[],
): FirmConversation[] {
  const readAtByClient = new Map<string, string | null>();
  for (const t of threads) readAtByClient.set(t.client_id, t.firm_last_read_at);

  const lastByClient = new Map<
    string,
    { body: string; sender: ClientMessageSender; createdAt: string }
  >();
  const unreadByClient = new Map<string, number>();
  for (const m of messages) {
    // Newest-first, so the first one seen per client is their last message.
    if (!lastByClient.has(m.client_id)) {
      lastByClient.set(m.client_id, {
        body: m.body,
        sender: m.sender,
        createdAt: m.created_at,
      });
    }
    if (m.sender === "client") {
      const cutoff = readAtByClient.get(m.client_id) ?? null;
      const cutoffMs = cutoff ? new Date(cutoff).getTime() : 0;
      if (new Date(m.created_at).getTime() > cutoffMs) {
        unreadByClient.set(
          m.client_id,
          (unreadByClient.get(m.client_id) ?? 0) + 1,
        );
      }
    }
  }

  const rows: FirmConversation[] = [];
  for (const c of clients) {
    if (c.archivedAt) continue;
    const last = lastByClient.get(c.id) ?? null;
    rows.push({
      clientId: c.id,
      clientName: c.displayName,
      lastMessage: last,
      unreadCount: unreadByClient.get(c.id) ?? 0,
      lastActivityAt: last?.createdAt ?? null,
    });
  }

  rows.sort((a, b) => {
    if (a.lastActivityAt && b.lastActivityAt) {
      return (
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime()
      );
    }
    if (a.lastActivityAt) return -1;
    if (b.lastActivityAt) return 1;
    return a.clientName.localeCompare(b.clientName);
  });
  return rows;
}

// Load the accountant's cross-client inbox on their RLS-scoped session client.
// Three cheap reads (clients, threads, recent messages) folded by
// buildFirmConversations — no SQL view/RPC, so nothing to migrate.
export async function listFirmConversations(
  sb: SupabaseClient,
): Promise<FirmConversation[] | MessagingSchemaMissing> {
  // Independent reads, one parallel batch (this loader runs every 10s while
  // the messages panel is open, so its depth is a recurring cost).
  const [threadsRes, clientsRes] = await Promise.all([
    sb.from("client_message_threads").select("client_id, firm_last_read_at"),
    sb
      .from("clients")
      .select("id, display_name, archived_at")
      .is("archived_at", null)
      .order("display_name", { ascending: true })
      .limit(500),
  ]);
  if (threadsRes.error) {
    if (isClientMessagingSchemaMissing(threadsRes.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw threadsRes.error;
  }
  const threads = (threadsRes.data ?? []) as {
    client_id: string;
    firm_last_read_at: string | null;
  }[];
  if (clientsRes.error) throw clientsRes.error;
  const clients = (
    (clientsRes.data ?? []) as {
      id: string;
      display_name: string | null;
      archived_at: string | null;
    }[]
  ).map((c) => ({
    id: c.id,
    displayName: c.display_name ?? "",
    archivedAt: c.archived_at,
  }));

  // Only pull messages for clients that actually have a thread. A thread is
  // get-or-created on every send, so "no thread" means "no messages" — this
  // keeps the `.in()` list to the handful of real conversations instead of
  // every client on the books.
  const activeIds = new Set(clients.map((c) => c.id));
  const relevantIds = threads
    .map((t) => t.client_id)
    .filter((id) => id && activeIds.has(id));
  if (relevantIds.length === 0) {
    return buildFirmConversations(clients, threads, []);
  }

  // Recent messages, newest-first; grouped in memory for last-message + unread.
  // Comment-cadence volume; the cap only bounds a very chatty firm.
  const msgRes = await sb
    .from("client_messages")
    .select("client_id, sender, body, created_at")
    .in("client_id", relevantIds)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (msgRes.error) {
    if (isClientMessagingSchemaMissing(msgRes.error)) {
      return CLIENT_MESSAGING_SCHEMA_MISSING;
    }
    throw msgRes.error;
  }
  const messages = (msgRes.data ?? []) as {
    client_id: string;
    sender: ClientMessageSender;
    body: string;
    created_at: string;
  }[];

  return buildFirmConversations(clients, threads, messages);
}
