// Xero connections data layer (migration 0740) — per client from day one.
//
// Dramatically simpler than db/quickbooks.ts on purpose: the table was born
// per-client (client_id NOT NULL) with the token-fingerprint column baked in,
// so there are NO legacy firm-level rows, NO tiered selects, and NO
// scope-fallback machinery. READS of display fields go through the
// authenticated client (RLS firm-scoped); token reads + ALL writes are
// service-role (the token columns aren't selectable by authenticated users).
// Token encryption reuses the QuickBooks cipher (same QBO_TOKEN_ENC_KEY, same
// envelope): encrypts when the key is configured, plaintext otherwise.

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import {
  maybeEncryptToken,
  decryptToken,
  tokenFingerprint,
} from "@/lib/quickbooks/token-cipher";

// Missing-schema detection for the xero_connections table (0740). The
// QuickBooks helper's regex only matches quickbooks_* table names, so it can't
// be reused here.
export function isMissingXeroSchema(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /xero_connections/i.test(err.message ?? "") ||
    /could not find the table|relation .* does not exist|column .* does not exist/i.test(
      err.message ?? "",
    )
  );
}

export type ClientXeroStatus = {
  connected: boolean;
  tenantId: string;
  tenantName: string | null;
  // Xero has no sandbox/production key split; the test target is the
  // resettable Demo Company, flagged by the org itself at connect time.
  isDemo: boolean;
  connectedAt: string;
};

// Read one client's Xero connection status for the UI (authenticated — RLS
// firm-scoped, token columns not selectable). Null = not connected / pre-0740.
export async function getClientXeroStatus(
  clientId: string,
): Promise<ClientXeroStatus | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("xero_connections")
    .select("tenant_id, tenant_name, is_demo, connected_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    if (!isMissingXeroSchema(error)) {
      console.error("[xero] getClientXeroStatus failed:", error);
    }
    return null;
  }
  if (!data) return null;
  return {
    connected: true,
    tenantId: data.tenant_id as string,
    tenantName: (data.tenant_name as string | null) ?? null,
    isDemo: data.is_demo === true,
    connectedAt: data.connected_at as string,
  };
}

// Does the current firm have ANY Xero connection (any client)? Drives the
// Integrations hub badge. RLS scopes it to the firm; false on error/pre-0740.
export async function firmHasAnyXeroConnection(): Promise<boolean> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("xero_connections")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingXeroSchema(error)) {
      console.error("[xero] firmHasAnyXeroConnection failed:", error);
    }
    return false;
  }
  return data != null;
}

export type UpsertXeroConnectionInput = {
  tenantId: string;
  connectionId: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  tenantName: string | null;
  countryCode: string | null;
  isDemo: boolean;
  connectedBy: string;
};

export type UpsertXeroConnectionResult =
  | { ok: true }
  // The Xero organisation is already linked to a DIFFERENT client row (the
  // tenant_id unique index) — the caller surfaces "already connected" instead
  // of clobbering the other client's connection.
  | { ok: false; reason: "tenant_in_use" }
  | { ok: false; reason: "migration_pending" }
  | { ok: false; reason: "error" };

// Store (or replace) a client's Xero connection — the OAuth callback's write.
// Service role. Tokens are encrypted when the key is configured; the refresh
// fingerprint is always stamped (the column exists from day one).
export async function upsertClientXeroConnection(
  firmId: string,
  clientId: string,
  input: UpsertXeroConnectionInput,
): Promise<UpsertXeroConnectionResult> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.from("xero_connections").upsert(
    {
      firm_id: firmId,
      client_id: clientId,
      tenant_id: input.tenantId,
      connection_id: input.connectionId,
      access_token: maybeEncryptToken(input.accessToken),
      refresh_token: maybeEncryptToken(input.refreshToken),
      access_token_expires_at: input.accessTokenExpiresAt,
      refresh_token_expires_at: input.refreshTokenExpiresAt,
      refresh_token_fingerprint: tokenFingerprint(input.refreshToken),
      tenant_name: input.tenantName,
      country_code: input.countryCode,
      is_demo: input.isDemo,
      connected_by: input.connectedBy,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "firm_id,client_id" },
  );
  if (!error) return { ok: true };
  // 23505 on the tenant unique index = this org is already another client's
  // connection (very real with one Demo Company during testing).
  if (
    error.code === "23505" ||
    /xero_connections_tenant_idx|duplicate key/i.test(error.message ?? "")
  ) {
    return { ok: false, reason: "tenant_in_use" };
  }
  if (isMissingXeroSchema(error)) {
    return { ok: false, reason: "migration_pending" };
  }
  console.error("[xero] upsertClientXeroConnection failed:", error);
  return { ok: false, reason: "error" };
}

export type XeroConnectionWithTokens = {
  tenantId: string;
  connectionId: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
};

// Rich read result so the health check can tell "genuinely unusable, reconnect
// needed" (absent) apart from a transient DB blip (read_error) — mirroring the
// QuickBooks connection reader's contract.
export type XeroConnectionReadResult =
  | { kind: "ok"; conn: XeroConnectionWithTokens }
  | { kind: "absent" }
  | { kind: "read_error" };

// Service-role read of the FULL connection including tokens (refresh +
// disconnect). Decrypt failures read as absent → the UI prompts a reconnect.
export async function readClientXeroConnection(
  firmId: string,
  clientId: string,
): Promise<XeroConnectionReadResult> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("xero_connections")
    .select(
      "tenant_id, connection_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at",
    )
    .eq("firm_id", firmId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    if (isMissingXeroSchema(error)) return { kind: "absent" };
    console.error("[xero] readClientXeroConnection failed:", error);
    return { kind: "read_error" };
  }
  if (!data) return { kind: "absent" };
  const accessToken = decryptToken(data.access_token as string);
  const refreshToken = decryptToken(data.refresh_token as string);
  if (accessToken === null || refreshToken === null) {
    console.error("[xero] could not decrypt stored tokens for client", clientId);
    return { kind: "absent" };
  }
  return {
    kind: "ok",
    conn: {
      tenantId: data.tenant_id as string,
      connectionId: (data.connection_id as string | null) ?? null,
      accessToken,
      refreshToken,
      accessTokenExpiresAt:
        (data.access_token_expires_at as string | null) ?? null,
      refreshTokenExpiresAt:
        (data.refresh_token_expires_at as string | null) ?? null,
    },
  };
}

export type UpdateXeroTokensResult =
  | { outcome: "updated" }
  // A concurrent refresh already rotated + stored newer tokens; re-read and use
  // those (Xero refresh tokens are single-use, so ours may be superseded).
  | { outcome: "raced" }
  // Not durably stored — the caller must DISCARD its rotation (handing out the
  // access token while the next refresh would use a dead stored token silently
  // breaks the connection).
  | { outcome: "error" };

// Persist rotated tokens with OPTIMISTIC CONCURRENCY on the refresh-token
// fingerprint (ciphertext is non-deterministic, so the token column itself
// can't be matched). First writer wins; a 0-row match means someone else
// already rotated.
export async function updateClientXeroTokens(
  firmId: string,
  clientId: string,
  expectedRefreshToken: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
  },
): Promise<UpdateXeroTokensResult> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("xero_connections")
    .update({
      access_token: maybeEncryptToken(tokens.accessToken),
      refresh_token: maybeEncryptToken(tokens.refreshToken),
      refresh_token_fingerprint: tokenFingerprint(tokens.refreshToken),
      access_token_expires_at: tokens.accessTokenExpiresAt,
      refresh_token_expires_at: tokens.refreshTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("firm_id", firmId)
    .eq("client_id", clientId)
    .eq("refresh_token_fingerprint", tokenFingerprint(expectedRefreshToken))
    .select("id");
  if (error) {
    if (!isMissingXeroSchema(error)) {
      console.error("[xero] updateClientXeroTokens failed:", error);
    }
    return { outcome: "error" };
  }
  return data && data.length > 0
    ? { outcome: "updated" }
    : { outcome: "raced" };
}

// Light service-role read of a client's CURRENT org link — tenant + Xero
// connection id only, NO token decrypt (a row whose tokens can't decrypt is
// exactly the one most likely being reconnected, and releasing its stale link
// needs these refs). Null when no row / pre-0740.
export async function getClientXeroLinkRefs(
  firmId: string,
  clientId: string,
): Promise<{ tenantId: string; connectionId: string | null } | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("xero_connections")
    .select("tenant_id, connection_id")
    .eq("firm_id", firmId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    if (!isMissingXeroSchema(error)) {
      console.error("[xero] getClientXeroLinkRefs failed:", error);
    }
    return null;
  }
  if (!data) return null;
  return {
    tenantId: data.tenant_id as string,
    connectionId: (data.connection_id as string | null) ?? null,
  };
}

// Remove a client's connection (disconnect). Service-role delete; no-op safe.
export async function clearClientXeroConnection(
  firmId: string,
  clientId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("xero_connections")
    .delete()
    .eq("firm_id", firmId)
    .eq("client_id", clientId);
  if (error && !isMissingXeroSchema(error)) {
    console.error("[xero] clearClientXeroConnection failed:", error);
  }
}

// Which of these Xero organisations are STORED connections (any firm)? The
// app↔org link at Xero is a single shared object — the import flow must NOT
// release ("disconnect") an org that a per-client connection is using, or that
// client's link dies with it. Service-role, cross-firm on purpose. On any
// error, returns ALL ids as in-use (fail closed: skipping a release is
// harmless; releasing a live connection is not).
export async function findXeroTenantIdsInUse(
  tenantIds: string[],
): Promise<Set<string>> {
  if (tenantIds.length === 0) return new Set();
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("xero_connections")
    .select("tenant_id")
    .in("tenant_id", tenantIds);
  if (error) {
    if (!isMissingXeroSchema(error)) {
      console.error("[xero] findXeroTenantIdsInUse failed:", error);
    }
    return isMissingXeroSchema(error) ? new Set() : new Set(tenantIds);
  }
  return new Set(
    (data ?? []).map((r) => (r as { tenant_id: string }).tenant_id),
  );
}
