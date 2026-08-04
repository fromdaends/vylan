// Calendar connections — reading and writing one person's Google link (1450).
//
// The storage_connections module (lib/db/filing.ts) is the shape this follows,
// with ONE substituted key: filing is scoped by firm_id, calendar by USER_ID.
// A calendar is personal; see the note at the top of migration 1450.
//
// READS DEGRADE, WRITES REFUSE — the house pattern. Before 1450 there is no
// table: getMyCalendarConnection() answers null, which renders the card's
// "connect your calendar" state, which is the truth.
//
// Tokens are encrypted with the FILING cipher deliberately. They are the same
// class of secret (an OAuth refresh token for a Google API) and the key already
// exists in production; a third copy of AES-GCM would be the drift the cohesion
// rule exists to prevent.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  decryptStorageToken,
  maybeEncryptStorageToken,
  storageTokenFingerprint,
} from "@/lib/filing/token-cipher";

export type CalendarConnectionStatus = "active" | "error" | "disconnected";

/** What the agenda card is allowed to see. No tokens — the grant forbids it. */
export type CalendarConnectionDisplay = {
  id: string;
  status: CalendarConnectionStatus;
  accountLabel: string | null;
  calendarId: string;
  lastSyncedAt: string | null;
  connectedAt: string;
};

function isCalendarSchemaMissing(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /calendar_connections/i.test(err.message ?? "") ||
    /could not find the table|relation .* does not exist|column .* does not exist/i.test(
      err.message ?? "",
    )
  );
}

/**
 * The signed-in person's own connection, or null.
 *
 * Deliberately reads through the SESSION client rather than the service role:
 * RLS on 1450 scopes the row to auth.uid(), so "your own" is enforced by the
 * database rather than by remembering to add a filter here.
 *
 * Returns 'error' rows too — the card needs to say "reconnect", which is a
 * different sentence from "connect".
 */
export async function getMyCalendarConnection(): Promise<CalendarConnectionDisplay | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("calendar_connections")
    .select(
      "id, status, account_label, calendar_id, last_synced_at, connected_at",
    )
    .neq("status", "disconnected")
    .maybeSingle();
  if (error) {
    if (isCalendarSchemaMissing(error)) return null;
    console.error("[calendar] connection read failed:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id as string,
    status: (data.status as CalendarConnectionStatus) ?? "active",
    accountLabel: (data.account_label as string | null) ?? null,
    calendarId: (data.calendar_id as string | null) ?? "primary",
    lastSyncedAt: (data.last_synced_at as string | null) ?? null,
    connectedAt: data.connected_at as string,
  };
}

export type CalendarTokensRow = {
  id: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  calendarId: string;
};

/**
 * One person's ACTIVE connection with decrypted tokens (service-role — the
 * caller has already proven who they are). "absent" = nothing usable (never
 * connected, disconnected, or tokens undecryptable => reconnect needed).
 */
export async function readMyCalendarTokens(
  userId: string,
): Promise<
  | { kind: "ok"; conn: CalendarTokensRow }
  | { kind: "absent" }
  | { kind: "read_error" }
> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("calendar_connections")
    .select(
      "id, access_token, refresh_token, access_token_expires_at, calendar_id",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    if (isCalendarSchemaMissing(error)) return { kind: "absent" };
    console.error("[calendar] token read failed:", error.message);
    return { kind: "read_error" };
  }
  if (!data || !data.access_token || !data.refresh_token) {
    return { kind: "absent" };
  }
  const accessToken = decryptStorageToken(data.access_token as string);
  const refreshToken = decryptStorageToken(data.refresh_token as string);
  if (accessToken == null || refreshToken == null) return { kind: "absent" };
  return {
    kind: "ok",
    conn: {
      id: data.id as string,
      accessToken,
      refreshToken,
      accessTokenExpiresAt:
        (data.access_token_expires_at as string | null) ?? null,
      calendarId: (data.calendar_id as string | null) ?? "primary",
    },
  };
}

/**
 * Store a fresh connection. Any previous row for this person is retired first
 * so the partial unique index (one ACTIVE per user) can never trip — a
 * reconnect is the ordinary case, not an error.
 */
export async function saveCalendarConnection(input: {
  userId: string;
  firmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  accountEmail: string | null;
}): Promise<"ok" | "error"> {
  const sb = getServiceRoleSupabase();
  const now = new Date().toISOString();

  const { error: retireErr } = await sb
    .from("calendar_connections")
    .update({ status: "disconnected", disconnected_at: now, updated_at: now })
    .eq("user_id", input.userId)
    .neq("status", "disconnected");
  if (retireErr) {
    if (isCalendarSchemaMissing(retireErr)) return "error";
    console.error("[calendar] retire previous failed:", retireErr.message);
    return "error";
  }

  const { error } = await sb.from("calendar_connections").insert({
    user_id: input.userId,
    firm_id: input.firmId,
    provider: "google",
    status: "active",
    access_token: maybeEncryptStorageToken(input.accessToken),
    refresh_token: maybeEncryptStorageToken(input.refreshToken),
    access_token_expires_at: input.accessTokenExpiresAt,
    refresh_token_fingerprint: storageTokenFingerprint(input.refreshToken),
    account_label: input.accountEmail,
    calendar_id: "primary",
    last_synced_at: null,
    connected_at: now,
    updated_at: now,
  });
  if (error) {
    console.error("[calendar] save failed:", error.message);
    return "error";
  }
  return "ok";
}

/**
 * Persist refreshed tokens with optimistic concurrency: the row must still
 * carry the fingerprint of the refresh token we refreshed FROM, so two
 * concurrent page loads never clobber each other. "stale" = the other won,
 * which is fine — its tokens are just as good.
 */
export async function updateCalendarTokens(
  userId: string,
  matchRefreshToken: string,
  next: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
  },
): Promise<"ok" | "stale" | "error"> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("calendar_connections")
    .update({
      access_token: maybeEncryptStorageToken(next.accessToken),
      refresh_token: maybeEncryptStorageToken(next.refreshToken),
      access_token_expires_at: next.accessTokenExpiresAt,
      refresh_token_fingerprint: storageTokenFingerprint(next.refreshToken),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("refresh_token_fingerprint", storageTokenFingerprint(matchRefreshToken))
    .select("id");
  if (error) {
    console.error("[calendar] token update failed:", error.message);
    return "error";
  }
  return (data?.length ?? 0) > 0 ? "ok" : "stale";
}

/** Stamp a successful read, for the card's "synced just now" line. */
export async function touchCalendarSync(userId: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("calendar_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) console.error("[calendar] sync stamp failed:", error.message);
}

/** Flag the connection as needing a reconnect (dead refresh token). */
export async function markCalendarConnectionError(
  userId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("calendar_connections")
    .update({ status: "error", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) console.error("[calendar] mark error failed:", error.message);
}

/**
 * Disconnect. Tokens are cleared from the row (the caller revokes them with
 * Google first); the row itself is KEPT so "you connected this once" stays
 * true. Returns the decrypted refresh token for revocation, or null when there
 * was nothing connected.
 */
export async function disconnectMyCalendar(
  userId: string,
): Promise<{ refreshToken: string | null } | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("calendar_connections")
    .select("id, refresh_token")
    .eq("user_id", userId)
    .neq("status", "disconnected")
    .maybeSingle();
  if (error) {
    if (isCalendarSchemaMissing(error)) return null;
    console.error("[calendar] disconnect read failed:", error.message);
    return null;
  }
  if (!data) return null;

  const refreshToken = data.refresh_token
    ? decryptStorageToken(data.refresh_token as string)
    : null;

  const now = new Date().toISOString();
  const { error: updErr } = await sb
    .from("calendar_connections")
    .update({
      status: "disconnected",
      access_token: null,
      refresh_token: null,
      refresh_token_fingerprint: null,
      access_token_expires_at: null,
      disconnected_at: now,
      updated_at: now,
    })
    .eq("id", data.id as string);
  if (updErr) {
    console.error("[calendar] disconnect failed:", updErr.message);
    return null;
  }
  return { refreshToken };
}
