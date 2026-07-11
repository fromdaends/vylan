// Persistence for propose-and-confirm actions (migration 0560, GATED).
//
// ALL writes go through the SERVICE-ROLE client: the table has no
// authenticated write grants, so a pending action's payload can never be
// tampered with via PostgREST between proposal and confirmation. Every
// function here is called ONLY after the route has authenticated the caller
// and RLS-verified the engagement, and every service-role read/write is
// additionally pinned by explicit firm/conversation predicates.

import { randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { CHAT_SCHEMA_MISSING, isChatSchemaMissing, type SchemaMissing } from "./db";
import type { AnyActionPayload, ChatActionType } from "./action-schemas";
import { ACTION_EXPIRY_MINUTES } from "./config";

export type PendingActionStatus =
  | "proposed"
  | "confirming"
  | "confirmed"
  | "cancelled"
  | "failed"
  | "expired";

export type PendingActionRow = {
  id: string;
  firm_id: string;
  engagement_id: string;
  conversation_id: string;
  user_id: string;
  action_type: ChatActionType;
  payload: AnyActionPayload;
  token: string;
  status: PendingActionStatus;
  expires_at: string;
  created_at: string;
  confirmed_by: string | null;
  resolved_at: string | null;
  error: string | null;
};

// What the panel renders (token included ONLY for still-confirmable cards —
// the caller decides via includeToken).
export type ActionCardData = {
  id: string;
  type: ChatActionType;
  payload: AnyActionPayload;
  status: PendingActionStatus;
  createdAt: string;
  expiresAt: string;
  error: string | null;
  token: string | null;
};

export function newActionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isActionExpired(row: { expires_at: string }, nowMs: number): boolean {
  const t = new Date(row.expires_at).getTime();
  return !Number.isFinite(t) || t <= nowMs;
}

export function toCard(
  row: PendingActionRow,
  opts: { includeToken: boolean; nowMs: number },
): ActionCardData {
  const expired =
    row.status === "proposed" && isActionExpired(row, opts.nowMs);
  const status = expired ? "expired" : row.status;
  return {
    id: row.id,
    type: row.action_type,
    payload: row.payload,
    status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    error: row.error,
    token: opts.includeToken && status === "proposed" ? row.token : null,
  };
}

export async function createPendingAction(input: {
  firmId: string;
  engagementId: string;
  conversationId: string;
  userId: string;
  type: ChatActionType;
  payload: AnyActionPayload;
}): Promise<PendingActionRow | SchemaMissing> {
  const service = getServiceRoleSupabase();
  const token = newActionToken();
  const expiresAt = new Date(
    Date.now() + ACTION_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString();
  const res = await service
    .from("chat_pending_actions")
    .insert({
      firm_id: input.firmId,
      engagement_id: input.engagementId,
      conversation_id: input.conversationId,
      user_id: input.userId,
      action_type: input.type,
      payload: input.payload,
      token,
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (res.error) {
    if (isChatSchemaMissing(res.error)) return CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return res.data as PendingActionRow;
}

// Service-role read pinned to the caller's firm (the route authenticated the
// caller and derived firmId server-side before calling this).
export async function getPendingAction(
  id: string,
  firmId: string,
): Promise<PendingActionRow | null | SchemaMissing> {
  const service = getServiceRoleSupabase();
  const res = await service
    .from("chat_pending_actions")
    .select("*")
    .eq("id", id)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (res.error) {
    if (isChatSchemaMissing(res.error)) return CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return (res.data as PendingActionRow) ?? null;
}

// Atomic claim: proposed -> confirming. Exactly ONE of two racing confirms
// wins (compare-and-swap on status, same trick as the jobs queue).
export async function claimPendingAction(
  id: string,
  firmId: string,
): Promise<boolean> {
  const service = getServiceRoleSupabase();
  const res = await service
    .from("chat_pending_actions")
    .update({ status: "confirming" })
    .eq("id", id)
    .eq("firm_id", firmId)
    .eq("status", "proposed")
    .select("id");
  if (res.error) throw res.error;
  return (res.data ?? []).length > 0;
}

export async function resolvePendingAction(
  id: string,
  firmId: string,
  outcome:
    | { status: "confirmed"; confirmedBy: string }
    | { status: "cancelled" }
    | { status: "expired" }
    | { status: "failed"; confirmedBy: string; error: string },
): Promise<void> {
  const service = getServiceRoleSupabase();
  const patch: Record<string, unknown> = {
    status: outcome.status,
    resolved_at: new Date().toISOString(),
  };
  if (outcome.status === "confirmed" || outcome.status === "failed") {
    patch.confirmed_by = outcome.confirmedBy;
  }
  if (outcome.status === "failed") patch.error = outcome.error;
  const res = await service
    .from("chat_pending_actions")
    .update(patch)
    .eq("id", id)
    .eq("firm_id", firmId);
  if (res.error) throw res.error;
}

// Every action of a conversation, oldest first, for the history endpoint.
// Service-role read pinned to firm + conversation, both of which the route
// RLS-verified before calling. Tokens are attached only to still-live
// proposed cards so a reloaded panel can still confirm them.
export async function listConversationActions(
  conversationId: string,
  firmId: string,
  nowMs: number,
): Promise<ActionCardData[] | SchemaMissing> {
  const service = getServiceRoleSupabase();
  const res = await service
    .from("chat_pending_actions")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("firm_id", firmId)
    .order("created_at", { ascending: true });
  if (res.error) {
    if (isChatSchemaMissing(res.error)) return CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  return ((res.data ?? []) as PendingActionRow[]).map((row) =>
    toCard(row, { includeToken: true, nowMs }),
  );
}

// Compact status lines for the system prompt so the model knows what became
// of its earlier proposals. Session-client read (RLS-scoped; the token
// column isn't in the authenticated grant, so select the visible columns).
export async function listRecentActionSummaries(
  sb: SupabaseClient,
  conversationId: string,
  limit: number,
): Promise<
  | { type: string; status: PendingActionStatus; createdAt: string }[]
  | SchemaMissing
> {
  const res = await sb
    .from("chat_pending_actions")
    .select("action_type, status, expires_at, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (res.error) {
    if (isChatSchemaMissing(res.error)) return CHAT_SCHEMA_MISSING;
    throw res.error;
  }
  const nowMs = Date.now();
  return ((res.data ?? []) as {
    action_type: string;
    status: PendingActionStatus;
    expires_at: string;
    created_at: string;
  }[])
    .map((r) => ({
      type: r.action_type,
      status:
        r.status === "proposed" && isActionExpired(r, nowMs)
          ? ("expired" as const)
          : r.status,
      createdAt: r.created_at,
    }))
    .reverse();
}
