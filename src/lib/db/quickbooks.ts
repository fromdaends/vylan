// Data layer for the QuickBooks (Intuit) connection — Stage 1, CONNECTION ONLY.
//
// Reads of the firm's connection STATUS go through the authenticated client so
// RLS scopes them to the firm (and the token columns are not even selectable —
// see migration 0410). WRITES go through the service role, because the table is
// service-role-write-only (no authenticated insert/update/delete grant), exactly
// like the Stripe Connect columns in 0370.
//
// Everything degrades gracefully before migration 0410 is applied to the remote
// DB (dev uses remote Supabase, no local Docker): a missing-table/column error
// is reported as a typed result / null so callers show a clean "set up" message
// instead of a 500.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import type { QuickbooksEnvironment } from "@/lib/quickbooks/client";

// PostgREST surfaces a not-yet-applied migration as a missing table (PGRST205 /
// Postgres 42P01) or a missing column (PGRST204 / 42703). Exported so the cache
// layer (0420) can degrade the same way before its migration is applied.
export function isMissingSchema(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /quickbooks_(connections|accounts|vendors|customers|tax_codes|items)/i.test(
      err.message ?? "",
    ) ||
    /could not find the table|relation .* does not exist|column .* does not exist/i.test(
      err.message ?? "",
    )
  );
}

export type FirmQuickbooksStatus = {
  connected: boolean;
  realmId: string;
  companyName: string | null;
  environment: QuickbooksEnvironment;
  connectedAt: string;
};

// Read the current firm's QuickBooks connection for the Settings UI. Returns null
// when not connected OR before the migration is applied. Never reads the tokens
// (the authenticated client cannot select them anyway).
export async function getFirmQuickbooksStatus(): Promise<FirmQuickbooksStatus | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("quickbooks_connections")
    .select("realm_id, company_name, environment, connected_at")
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] getFirmQuickbooksStatus failed:", error);
    }
    return null;
  }
  if (!data) return null;
  return {
    connected: true,
    realmId: data.realm_id as string,
    companyName: (data.company_name as string | null) ?? null,
    environment:
      (data.environment as string) === "production" ? "production" : "sandbox",
    connectedAt: data.connected_at as string,
  };
}

export type UpsertQuickbooksConnectionInput = {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  companyName: string | null;
  environment: QuickbooksEnvironment;
  connectedBy: string | null;
};

export type UpsertConnectionResult =
  | { ok: true }
  | { ok: false; reason: "migration_pending" | "error" };

// Persist (insert or replace) the firm's QuickBooks connection after a successful
// OAuth exchange. Service-role write — the column is not authenticated-writable.
// connected_at is intentionally omitted so it defaults on first connect and is
// preserved on a reconnect; updated_at is stamped every time.
export async function upsertFirmQuickbooksConnection(
  firmId: string,
  input: UpsertQuickbooksConnectionInput,
): Promise<UpsertConnectionResult> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.from("quickbooks_connections").upsert(
    {
      firm_id: firmId,
      realm_id: input.realmId,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      access_token_expires_at: input.accessTokenExpiresAt,
      refresh_token_expires_at: input.refreshTokenExpiresAt,
      company_name: input.companyName,
      environment: input.environment,
      connected_by: input.connectedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "firm_id" },
  );
  if (error) {
    if (isMissingSchema(error)) return { ok: false, reason: "migration_pending" };
    console.error("[quickbooks] upsertFirmQuickbooksConnection failed:", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

// Cheap service-role "is this firm connected to QuickBooks?" check, for the
// classify worker to decide whether to spend tokens on the (extra) transaction
// extraction pass. Selects only realm_id (never the tokens). Degrades to false
// on any error or before the migration is applied, so a firm without QuickBooks
// — or an environment without the table yet — simply never runs the extra pass.
export async function isFirmQuickbooksConnected(
  firmId: string,
): Promise<boolean> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("quickbooks_connections")
    .select("realm_id")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] isFirmQuickbooksConnected failed:", error);
    }
    return false;
  }
  return Boolean(data);
}

export type QuickbooksConnectionWithTokens = {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  environment: QuickbooksEnvironment;
};

// Service-role read of the FULL connection, including the OAuth tokens, for token
// refresh + disconnect. The token columns are not readable by the authenticated
// client (migration 0410), so this MUST go through the service role. Returns null
// when not connected or before the migration is applied.
export async function getFirmQuickbooksConnectionWithTokens(
  firmId: string,
): Promise<QuickbooksConnectionWithTokens | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("quickbooks_connections")
    .select(
      "realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment",
    )
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error(
        "[quickbooks] getFirmQuickbooksConnectionWithTokens failed:",
        error,
      );
    }
    return null;
  }
  if (!data) return null;
  return {
    realmId: data.realm_id as string,
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    accessTokenExpiresAt: (data.access_token_expires_at as string | null) ?? null,
    refreshTokenExpiresAt:
      (data.refresh_token_expires_at as string | null) ?? null,
    environment:
      (data.environment as string) === "production" ? "production" : "sandbox",
  };
}

export type UpdateTokensResult =
  // Our rotation was durably persisted.
  | { outcome: "updated" }
  // A CONCURRENT refresh already rotated the token (our optimistic match found 0
  // rows). The caller must re-read and use the stored token, not its own.
  | { outcome: "raced" }
  // The write failed — the rotated refresh token is NOT stored, so the caller
  // must NOT hand out its access token (the next refresh would use a dead token).
  | { outcome: "error" };

// Persist refreshed tokens (service role) with OPTIMISTIC CONCURRENCY. Intuit
// rotates the refresh token, so two concurrent refreshes (both reading the same
// old token) must not clobber each other: the update only matches the row whose
// refresh_token STILL equals expectedRefreshToken, so the first writer wins
// ("updated") and the second matches 0 rows ("raced"). A genuine write error
// returns "error" so the caller never trusts an unsaved rotation. Firm-scoped, so
// a refresh can never touch another firm's row.
//
// refresh_token_expires_at is overwritten ONLY when the response carried a value:
// Intuit's refresh-token expiry counts DOWN toward the original grant, and a
// partial response must not wipe the known expiry with NULL.
export async function updateFirmQuickbooksTokens(
  firmId: string,
  expectedRefreshToken: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
  },
): Promise<UpdateTokensResult> {
  const sb = getServiceRoleSupabase();
  const patch: Record<string, unknown> = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    access_token_expires_at: tokens.accessTokenExpiresAt,
    updated_at: new Date().toISOString(),
  };
  if (tokens.refreshTokenExpiresAt != null) {
    patch.refresh_token_expires_at = tokens.refreshTokenExpiresAt;
  }
  const { data, error } = await sb
    .from("quickbooks_connections")
    .update(patch)
    .eq("firm_id", firmId)
    .eq("refresh_token", expectedRefreshToken)
    .select("id");
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] updateFirmQuickbooksTokens failed:", error);
    }
    return { outcome: "error" };
  }
  return data && data.length > 0 ? { outcome: "updated" } : { outcome: "raced" };
}

// Remove the firm's connection entirely (disconnect). Service-role delete. Safe
// to call when nothing exists (no-op) or before the migration is applied.
export async function clearFirmQuickbooksConnection(
  firmId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("quickbooks_connections")
    .delete()
    .eq("firm_id", firmId);
  if (error && !isMissingSchema(error)) {
    console.error("[quickbooks] clearFirmQuickbooksConnection failed:", error);
  }
}
