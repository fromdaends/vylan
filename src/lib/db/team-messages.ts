// Team group chat (migration 0870) — the firm-wide, internal, human↔human
// thread. ONE thread per firm; the client NEVER touches these tables. Mirrors
// the client-messages pattern (firm-scoped RLS, denormalized sender_name, a
// per-user read pointer) but simpler: no thread row (the firm is the thread) and
// no service-role/portal path.
//
// GATED on 0870: every reader/writer treats a missing table/column as "not
// activated yet" (returns the sentinel) instead of throwing, so this deploys
// before the SQL is applied (dev + prod run against remote Supabase).

import type { SupabaseClient } from "@supabase/supabase-js";
import { userDisplayLabel } from "@/lib/db/users";

export type TeamMessageRow = {
  id: string;
  sender_user_id: string | null;
  sender_name: string;
  body: string;
  created_at: string;
};

// Server-side cap, mirrored by the DB check constraint and the composer.
export const TEAM_MESSAGE_MAX_LENGTH = 4000;
// How many messages the thread loads (newest N). Team cadence never hits this.
export const TEAM_MESSAGE_PAGE_SIZE = 500;

export const TEAM_CHAT_SCHEMA_MISSING = Symbol("team-chat-schema-missing");
export type TeamChatSchemaMissing = typeof TEAM_CHAT_SCHEMA_MISSING;

// Missing TABLE (PGRST205 / 42P01) or COLUMN (PGRST204 / 42703). Codes ONLY,
// never message text (repo rule).
export function isTeamChatSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

// PURE: unread for a given viewer — messages from SOMEONE ELSE newer than their
// last-read stamp (own messages never badge you). Exported for a unit test and
// shared by the page (initial badge) + the API (poll).
export function countTeamUnreadForUser(
  messages: Pick<TeamMessageRow, "sender_user_id" | "created_at">[],
  lastReadAt: string | null,
  myUserId: string,
): number {
  const cutoff = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  return messages.filter(
    (m) =>
      m.sender_user_id !== myUserId &&
      new Date(m.created_at).getTime() > cutoff,
  ).length;
}

// Overwrite each message's DISPLAYED sender name with the author's CURRENT name
// (resolved live from the users row via sender_user_id). Two reasons: (1) a
// renamed teammate shows their current name on every past message, like the
// rest of the team UI; (2) it neutralizes the stored, app-supplied sender_name
// as an impersonation vector — a raw insert could spoof sender_name, but we
// display the REAL author's name looked up by their immutable id. The stored
// sender_name stays the fallback for an author who has LEFT the firm (their
// users row is no longer visible via RLS → not in the map).
async function applyLiveSenderNames(
  sb: SupabaseClient,
  messages: TeamMessageRow[],
): Promise<TeamMessageRow[]> {
  const ids = [
    ...new Set(
      messages.map((m) => m.sender_user_id).filter((x): x is string => !!x),
    ),
  ];
  if (ids.length === 0) return messages;
  const { data } = await sb
    .from("users")
    .select("id, display_name, name, email")
    .in("id", ids);
  const nameById = new Map<string, string>();
  for (const u of (data as Array<{
    id: string;
    display_name: string | null;
    name: string;
    email: string;
  }> | null) ?? []) {
    nameById.set(u.id, userDisplayLabel(u));
  }
  if (nameById.size === 0) return messages;
  return messages.map((m) =>
    m.sender_user_id && nameById.has(m.sender_user_id)
      ? { ...m, sender_name: nameById.get(m.sender_user_id) as string }
      : m,
  );
}

// The firm's thread, oldest first (fetch newest-first for the LIMIT, reverse).
// RLS scopes to the caller's firm.
export async function listTeamMessages(
  sb: SupabaseClient,
): Promise<TeamMessageRow[] | TeamChatSchemaMissing> {
  const res = await sb
    .from("team_messages")
    .select("id, sender_user_id, sender_name, body, created_at")
    .order("created_at", { ascending: false })
    .limit(TEAM_MESSAGE_PAGE_SIZE);
  if (res.error) {
    if (isTeamChatSchemaMissing(res.error)) return TEAM_CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return applyLiveSenderNames(sb, ((res.data ?? []) as TeamMessageRow[]).reverse());
}

// Insert a message as the current user. The RLS insert policy enforces
// firm-scope + self-authorship; this just shapes the row and returns it so the
// composer can append without a refetch.
export async function insertTeamMessage(
  sb: SupabaseClient,
  row: { firmId: string; userId: string; senderName: string; body: string },
): Promise<TeamMessageRow | TeamChatSchemaMissing> {
  const res = await sb
    .from("team_messages")
    .insert({
      firm_id: row.firmId,
      sender_user_id: row.userId,
      sender_name: row.senderName,
      body: row.body,
    })
    .select("id, sender_user_id, sender_name, body, created_at")
    .single();
  if (res.error) {
    if (isTeamChatSchemaMissing(res.error)) return TEAM_CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return res.data as TeamMessageRow;
}

// The caller's last-read stamp (null = never opened), or the sentinel pre-0870.
export async function getTeamLastReadAt(
  sb: SupabaseClient,
  userId: string,
): Promise<string | null | TeamChatSchemaMissing> {
  const res = await sb
    .from("team_message_reads")
    .select("last_read_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) {
    if (isTeamChatSchemaMissing(res.error)) return TEAM_CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return (res.data as { last_read_at: string } | null)?.last_read_at ?? null;
}

// Stamp "this user has seen the thread as of now" (upsert their pointer row).
export async function markTeamReadByUser(
  sb: SupabaseClient,
  firmId: string,
  userId: string,
): Promise<boolean | TeamChatSchemaMissing> {
  const res = await sb
    .from("team_message_reads")
    .upsert(
      { firm_id: firmId, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: "firm_id,user_id" },
    )
    .select("user_id");
  if (res.error) {
    if (isTeamChatSchemaMissing(res.error)) return TEAM_CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return (res.data ?? []).length > 0;
}
