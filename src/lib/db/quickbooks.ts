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
// Postgres 42P01) or a missing column (PGRST204 / 42703).
function isMissingSchema(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /quickbooks_connections/i.test(err.message ?? "") ||
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
