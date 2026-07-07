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

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import {
  maybeEncryptToken,
  decryptToken,
  tokenFingerprint,
  isTokenEncryptionConfigured,
} from "@/lib/quickbooks/token-cipher";
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
  companyCountry: string | null;
  environment: QuickbooksEnvironment;
  connectedBy: string | null;
};

export type UpsertConnectionResult =
  { ok: true } | { ok: false; reason: "migration_pending" | "error" };

// Persist (insert or replace) the firm's QuickBooks connection after a successful
// OAuth exchange. Service-role write — the column is not authenticated-writable.
// connected_at is intentionally omitted so it defaults on first connect and is
// preserved on a reconnect; updated_at is stamped every time.
export async function upsertFirmQuickbooksConnection(
  firmId: string,
  input: UpsertQuickbooksConnectionInput,
): Promise<UpsertConnectionResult> {
  const sb = getServiceRoleSupabase();
  const common = {
    firm_id: firmId,
    realm_id: input.realmId,
    access_token_expires_at: input.accessTokenExpiresAt,
    refresh_token_expires_at: input.refreshTokenExpiresAt,
    company_name: input.companyName,
    environment: input.environment,
    connected_by: input.connectedBy,
    updated_at: new Date().toISOString(),
  };
  const onConflict = "firm_id";
  const upsert = (record: Record<string, unknown>) =>
    sb.from("quickbooks_connections").upsert(record, { onConflict });
  // Tier 1 (0480 + 0470): ENCRYPTED tokens + the refresh-token fingerprint (the
  // optimistic-lock key) + company_country.
  let error = (
    await upsert({
      ...common,
      access_token: maybeEncryptToken(input.accessToken),
      refresh_token: maybeEncryptToken(input.refreshToken),
      refresh_token_fingerprint: tokenFingerprint(input.refreshToken),
      company_country: input.companyCountry,
    })
  ).error;
  if (error && isMissingSchema(error)) {
    // The fallback tiers below store PLAINTEXT (pre-0480 the optimistic lock
    // matches on the raw refresh token, so encrypting would break refresh). When
    // an encryption key IS configured, silently falling back would defeat the
    // whole point of the key — refuse instead. The callback maps
    // "migration_pending" to the "finish setup" message (apply 0480, then retry).
    if (isTokenEncryptionConfigured()) {
      console.error(
        "[quickbooks] refusing plaintext fallback: QBO_TOKEN_ENC_KEY is set but migration 0480 (refresh_token_fingerprint) is not applied",
      );
      return { ok: false, reason: "migration_pending" };
    }
    // Tier 2 (0470, no 0480): no fingerprint column, so we must NOT encrypt — the
    // legacy optimistic lock still matches on the RAW refresh token. Store plaintext.
    error = (
      await upsert({
        ...common,
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
        company_country: input.companyCountry,
      })
    ).error;
    if (error && isMissingSchema(error)) {
      // Tier 3 (pre-0470): plaintext tokens only.
      error = (
        await upsert({
          ...common,
          access_token: input.accessToken,
          refresh_token: input.refreshToken,
        })
      ).error;
    }
  }
  if (error) {
    if (isMissingSchema(error))
      return { ok: false, reason: "migration_pending" };
    console.error("[quickbooks] upsertFirmQuickbooksConnection failed:", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

// Self-heal the connected company's country (service role). Used by the sync job
// so a connection that predates the tax-line feature (or pre-0470) gets its
// country populated without a reconnect. Best-effort + graceful: a missing column
// (pre-0470) or error is swallowed. Only writes when `country` is non-null.
export async function updateFirmQuickbooksCompanyCountry(
  firmId: string,
  country: string | null,
): Promise<void> {
  if (!country) return;
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("quickbooks_connections")
    .update({ company_country: country })
    .eq("firm_id", firmId);
  if (error && !isMissingSchema(error)) {
    console.error(
      "[quickbooks] updateFirmQuickbooksCompanyCountry failed:",
      error,
    );
  }
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
  companyCountry: string | null;
};

// Rich result for the full-connection read, so callers can tell a connection
// that is genuinely UNUSABLE (no row, pre-migration, or stored tokens that can't
// be decrypted — only a reconnect fixes those) apart from a TRANSIENT read
// failure (network/DB blip — retrying may succeed). The health check maps
// "absent" to a reconnect banner and "read_error" to "ok", so a one-off blip
// never shows a false alarm.
export type QuickbooksConnectionReadResult =
  | { kind: "ok"; conn: QuickbooksConnectionWithTokens }
  | { kind: "absent" }
  | { kind: "read_error" };

// Service-role read of the FULL connection, including the OAuth tokens, for token
// refresh + disconnect. The token columns are not readable by the authenticated
// client (migration 0410), so this MUST go through the service role.
export async function readFirmQuickbooksConnection(
  firmId: string,
): Promise<QuickbooksConnectionReadResult> {
  const sb = getServiceRoleSupabase();
  // Widest select first (0470 company_country); fall back to the pre-0470 column
  // set on a missing-column error so token refresh keeps working before the
  // migration lands.
  const selects = [
    "realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, company_country",
    "realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment",
  ] as const;
  let data: Record<string, unknown> | null = null;
  let error: { code?: string; message?: string } | null = null;
  for (const sel of selects) {
    const res = await sb
      .from("quickbooks_connections")
      .select(sel)
      .eq("firm_id", firmId)
      .maybeSingle();
    if (res.error && isMissingSchema(res.error)) {
      error = res.error;
      continue;
    }
    data = res.data as Record<string, unknown> | null;
    error = res.error;
    break;
  }
  if (error) {
    // Pre-migration = the feature isn't live: genuinely absent. Anything else is
    // a transient DB/network failure — report it as such, NOT as a dead
    // connection.
    if (isMissingSchema(error)) return { kind: "absent" };
    console.error(
      "[quickbooks] readFirmQuickbooksConnection failed:",
      error,
    );
    return { kind: "read_error" };
  }
  if (!data) return { kind: "absent" };
  // Decrypt the tokens (a legacy plaintext value passes through unchanged). A
  // decrypt failure (missing/rotated key, tamper) means the stored token is
  // unusable — treat the connection as not-connected rather than handing out
  // garbage, so the UI prompts a reconnect instead of the API silently 401ing.
  const accessToken = decryptToken(data.access_token as string);
  const refreshToken = decryptToken(data.refresh_token as string);
  if (accessToken === null || refreshToken === null) {
    console.error(
      "[quickbooks] could not decrypt stored tokens for firm",
      firmId,
    );
    return { kind: "absent" };
  }
  return {
    kind: "ok",
    conn: {
      realmId: data.realm_id as string,
      accessToken,
      refreshToken,
      accessTokenExpiresAt:
        (data.access_token_expires_at as string | null) ?? null,
      refreshTokenExpiresAt:
        (data.refresh_token_expires_at as string | null) ?? null,
      environment:
        (data.environment as string) === "production"
          ? "production"
          : "sandbox",
      companyCountry: (data.company_country as string | null) ?? null,
    },
  };
}

// Back-compat thin wrapper: the token itself, or null for BOTH "absent" and
// "read_error" (callers that just need a token treat every miss the same).
export async function getFirmQuickbooksConnectionWithTokens(
  firmId: string,
): Promise<QuickbooksConnectionWithTokens | null> {
  const res = await readFirmQuickbooksConnection(firmId);
  return res.kind === "ok" ? res.conn : null;
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
//
// When tokens are encrypted, the stored refresh_token is non-deterministic
// ciphertext and can't be matched directly, so the optimistic lock matches on the
// stable refresh_token_fingerprint (sha256 of the plaintext) instead — same guard,
// same semantics. Falls back to the legacy raw-token match before migration 0480.
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
  const expiryPatch =
    tokens.refreshTokenExpiresAt != null
      ? { refresh_token_expires_at: tokens.refreshTokenExpiresAt }
      : {};
  const commonPatch = {
    access_token_expires_at: tokens.accessTokenExpiresAt,
    updated_at: new Date().toISOString(),
    ...expiryPatch,
  };

  // Primary path (0480): store ENCRYPTED tokens + the new fingerprint, and match
  // the old row by its fingerprint (identical whether the old token is stored
  // encrypted or as legacy plaintext — the fingerprint is always of the plaintext).
  let res = await sb
    .from("quickbooks_connections")
    .update({
      ...commonPatch,
      access_token: maybeEncryptToken(tokens.accessToken),
      refresh_token: maybeEncryptToken(tokens.refreshToken),
      refresh_token_fingerprint: tokenFingerprint(tokens.refreshToken),
    })
    .eq("firm_id", firmId)
    .eq("refresh_token_fingerprint", tokenFingerprint(expectedRefreshToken))
    .select("id");

  if (res.error && isMissingSchema(res.error)) {
    // Same plaintext-refusal rule as the upsert: with an encryption key
    // configured, never write plaintext tokens just because 0480 is missing.
    // "error" makes the caller discard the rotation (the connection degrades
    // gracefully) instead of silently downgrading to plaintext at rest.
    if (isTokenEncryptionConfigured()) {
      console.error(
        "[quickbooks] refusing plaintext token rotation: QBO_TOKEN_ENC_KEY is set but migration 0480 is not applied",
      );
      return { outcome: "error" };
    }
    // Pre-0480: no fingerprint column. Store PLAINTEXT (so encryption isn't left
    // un-matchable) and match on the raw refresh token, exactly as before.
    res = await sb
      .from("quickbooks_connections")
      .update({
        ...commonPatch,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      })
      .eq("firm_id", firmId)
      .eq("refresh_token", expectedRefreshToken)
      .select("id");
  }

  if (res.error) {
    if (!isMissingSchema(res.error)) {
      console.error(
        "[quickbooks] updateFirmQuickbooksTokens failed:",
        res.error,
      );
    }
    return { outcome: "error" };
  }
  return res.data && res.data.length > 0
    ? { outcome: "updated" }
    : { outcome: "raced" };
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

// Service-role read of just WHICH company a firm is connected to (realm +
// environment) — no token columns, so it works even when the stored tokens can't
// be decrypted. Used by the OAuth callback to detect that the connected COMPANY
// changed and old cached/learned/draft data must be retired. Returns null when
// not connected or pre-migration.
export async function getFirmQuickbooksRealm(
  firmId: string,
): Promise<{ realmId: string; environment: QuickbooksEnvironment } | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("quickbooks_connections")
    .select("realm_id, environment")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[quickbooks] getFirmQuickbooksRealm failed:", error);
    }
    return null;
  }
  if (!data) return null;
  return {
    realmId: data.realm_id as string,
    environment:
      (data.environment as string) === "production" ? "production" : "sandbox",
  };
}
