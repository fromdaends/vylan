// Persistence for the engagement chat: one conversation per engagement,
// append-only messages. Everything runs on the caller's RLS-scoped session
// client, so firm scoping is enforced by the database, not by this code.
//
// GATED on migration 0550: every reader/writer treats a missing table as
// "chat not activated yet" (returns the NOT_READY sentinel) instead of
// throwing, so the code can deploy before the SQL is applied — the repo's
// tiered-migration pattern.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatRole = "user" | "assistant";

export type ChatMessageRow = {
  id: string;
  role: ChatRole;
  content: string;
  user_id: string | null;
  created_at: string;
};

// Sentinel for "migration 0550 not applied on this environment".
export const CHAT_SCHEMA_MISSING = Symbol("chat-schema-missing");
export type SchemaMissing = typeof CHAT_SCHEMA_MISSING;

// PostgREST reports a missing TABLE as PGRST205 (schema-cache miss on the
// relation); Postgres proper reports undefined_table 42P01. Missing-column
// codes (PGRST204 / 42703) are included for safety during partial applies.
// Match on codes ONLY, never message text (same rule as engagements.ts).
export function isChatSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

// Find the engagement's conversation, creating it on first use. Returns the
// conversation id, null when the engagement has no conversation AND create
// was not requested, or the NOT_READY sentinel pre-migration.
export async function getConversationId(
  sb: SupabaseClient,
  firmId: string,
  engagementId: string,
  opts: { create: boolean },
): Promise<string | null | SchemaMissing> {
  const existing = await sb
    .from("chat_conversations")
    .select("id")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (existing.error) {
    if (isChatSchemaMissing(existing.error)) return CHAT_SCHEMA_MISSING;
    throw existing.error;
  }
  if (existing.data) return (existing.data as { id: string }).id;
  if (!opts.create) return null;

  const inserted = await sb
    .from("chat_conversations")
    .insert({ firm_id: firmId, engagement_id: engagementId })
    .select("id")
    .maybeSingle();
  if (inserted.error) {
    if (isChatSchemaMissing(inserted.error)) return CHAT_SCHEMA_MISSING;
    // Unique(engagement_id) race with a teammate's first message: re-read.
    if (inserted.error.code === "23505") {
      const reread = await sb
        .from("chat_conversations")
        .select("id")
        .eq("engagement_id", engagementId)
        .maybeSingle();
      if (reread.error) throw reread.error;
      return (reread.data as { id: string } | null)?.id ?? null;
    }
    throw inserted.error;
  }
  return (inserted.data as { id: string } | null)?.id ?? null;
}

// The last `limit` messages of a conversation, oldest first (fetch newest-
// first for the LIMIT, then reverse so callers render/replay in order).
export async function listChatMessages(
  sb: SupabaseClient,
  conversationId: string,
  limit: number,
): Promise<ChatMessageRow[] | SchemaMissing> {
  const res = await sb
    .from("chat_messages")
    .select("id, role, content, user_id, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (res.error) {
    if (isChatSchemaMissing(res.error)) return CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return ((res.data ?? []) as ChatMessageRow[]).reverse();
}

// Timestamps of MY user turns since `sinceIso` — the rate-limit ledger read.
// RLS already scopes to my firm; the explicit user filter narrows to me.
export async function listUserTurnTimes(
  sb: SupabaseClient,
  userId: string,
  sinceIso: string,
): Promise<string[] | SchemaMissing> {
  const res = await sb
    .from("chat_messages")
    .select("created_at")
    .eq("user_id", userId)
    .eq("role", "user")
    .gt("created_at", sinceIso);
  if (res.error) {
    if (isChatSchemaMissing(res.error)) return CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return ((res.data ?? []) as { created_at: string }[]).map(
    (r) => r.created_at,
  );
}

export async function insertChatMessage(
  sb: SupabaseClient,
  row: {
    conversationId: string;
    firmId: string;
    // null for assistant turns (the RLS insert policy requires it).
    userId: string | null;
    role: ChatRole;
    content: string;
  },
): Promise<void | SchemaMissing> {
  const res = await sb.from("chat_messages").insert({
    conversation_id: row.conversationId,
    firm_id: row.firmId,
    user_id: row.userId,
    role: row.role,
    content: row.content,
  });
  if (res.error) {
    if (isChatSchemaMissing(res.error)) return CHAT_SCHEMA_MISSING;
    throw res.error;
  }
}
