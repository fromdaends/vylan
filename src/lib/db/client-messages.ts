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
