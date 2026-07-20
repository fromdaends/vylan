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

// ── Per-client scoping (migration 0710) ──────────────────────────────────────
// The QuickBooks tables moved from ONE row per FIRM to one row per (firm, client),
// keyed by (firm_id, client_id) unique indexes with NULLS NOT DISTINCT. Every
// firm-scoped function below takes an OPTIONAL `clientId`:
//   * undefined (omitted) ≡ null → the FIRM-LEVEL row (client_id IS NULL).
//   * <uuid> string              → that specific client's row(s).
// undefined and null are treated identically — both mean "the firm-level row".
//
// WHY undefined ≢ "no filter": post-0710 a firm can have BOTH a firm-level row and
// per-client rows at once (during the Phase 2→3 transition). A no-filter single-row
// read would then match multiple rows and break (.maybeSingle() errors). Filtering
// client_id IS NULL returns exactly the one firm-level row.
//
// GRACEFUL DEGRADATION: this repo applies migrations manually, so 0710 may not be
// live yet. The scoped query (with the client_id filter) is always tried first; if
// the client_id column doesn't exist it fails with a missing-schema error. The
// degrade to the ORIGINAL no-filter query is then allowed ONLY for the firm-level
// scope (undefined/null) — pre-0710 that returns the single legacy row, preserving
// behavior. For a SPECIFIC client, dropping the filter would wrongly hit the
// firm-level row (wrong read / disconnect DATA LOSS / connect clobber), so we must
// NOT fall back — instead the missing-schema error surfaces and the caller yields
// "absent"/no-op (that client simply has no row yet, pre-0710).
export type QuickbooksClientScope = string | null | undefined;

// Firm-level scope = undefined or null (the client_id IS NULL row). Only in this
// case may a pre-0710 missing-schema error degrade to the no-filter fallback; a
// specific client id must never fall back to the firm-level row.
export function isFirmLevelScope(clientId: QuickbooksClientScope): boolean {
  return clientId === undefined || clientId === null;
}

// Narrow a select/update/delete builder to the requested client scope. undefined
// and null both mean the firm-level row (client_id IS NULL); only a uuid string
// filters to a specific client. Kept intentionally loose about the builder type —
// every PostgREST filter builder (select/update/delete) exposes .eq and .is.
export function withClientScope<Q>(q: Q, clientId: QuickbooksClientScope): Q {
  const b = q as unknown as {
    eq: (col: string, val: unknown) => Q;
    is: (col: string, val: unknown) => Q;
  };
  return typeof clientId === "string"
    ? b.eq("client_id", clientId)
    : b.is("client_id", null);
}

// Run a client-scoped query, degrading to the firm-only (no client_id filter)
// query only when the client_id column doesn't exist yet (0710 not applied) AND
// the scope is firm-level. Both thunks must build a FRESH query (PostgREST builders
// are single-use). The scoped thunk always runs first; the legacy thunk runs only
// on a missing-schema error for a firm-level scope. For a specific client the
// scoped (errored) result is returned as-is, so the caller yields "absent"/no-op —
// never the firm-level row.
export async function runWithClientFallback<
  R extends { error: { code?: string; message?: string } | null },
>(
  clientId: QuickbooksClientScope,
  scoped: () => PromiseLike<R>,
  legacy: () => PromiseLike<R>,
): Promise<R> {
  const res = await scoped();
  if (res.error && isMissingSchema(res.error) && isFirmLevelScope(clientId)) {
    return legacy();
  }
  return res;
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
export async function getFirmQuickbooksStatus(
  clientId?: QuickbooksClientScope,
): Promise<FirmQuickbooksStatus | null> {
  const sb = await getServerSupabase();
  const base = () =>
    sb
      .from("quickbooks_connections")
      .select("realm_id, company_name, environment, connected_at");
  const { data, error } = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId).maybeSingle(),
    () => base().maybeSingle(),
  );
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

// Read a SPECIFIC client's QuickBooks connection status (0710). Same shape as
// getFirmQuickbooksStatus, or null when that client has no connection. Thin
// wrapper over the client-scoped path above.
export async function getClientQuickbooksStatus(
  clientId: string,
): Promise<FirmQuickbooksStatus | null> {
  return getFirmQuickbooksStatus(clientId);
}

// Does the current firm have ANY QuickBooks connection at all — firm-level OR for
// any client? This is the "does this firm use QuickBooks" signal that gates the
// QuickBooks UI (sidebar nav, Integrations hub card, command-palette entry) so
// NOTHING QuickBooks-y shows until the firm has connected at least one company.
// Distinct from getFirmQuickbooksStatus (scoped to a single connection row): this
// counts per-client connections too (no client_id filter). RLS scopes it to the
// firm. Returns false before the migration / on any error.
export async function firmHasAnyQuickbooksConnection(): Promise<boolean> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("quickbooks_connections")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error(
        "[quickbooks] firmHasAnyQuickbooksConnection failed:",
        error,
      );
    }
    return false;
  }
  return data != null;
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
  clientId?: QuickbooksClientScope,
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
  // One insert-or-replace attempt. `extra` carries the optional client_id column
  // and `onConflict` names the matching uniqueness. The PRIMARY attempt always
  // targets the (firm_id, client_id) unique index (0710, NULLS NOT DISTINCT) with
  // client_id set (null for a firm-level row); the FALLBACK targets the legacy
  // firm_id unique (0410) with client_id omitted, for pre-0710 environments.
  const attempt = async (
    extra: Record<string, string | null>,
    onConflict: string,
  ): Promise<UpsertConnectionResult> => {
    const base = { ...common, ...extra };
    const upsert = (record: Record<string, unknown>) =>
      sb.from("quickbooks_connections").upsert(record, { onConflict });
    // Tier 1 (0480 + 0470): ENCRYPTED tokens + the refresh-token fingerprint (the
    // optimistic-lock key) + company_country.
    let error = (
      await upsert({
        ...base,
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
          ...base,
          access_token: input.accessToken,
          refresh_token: input.refreshToken,
          company_country: input.companyCountry,
        })
      ).error;
      if (error && isMissingSchema(error)) {
        // Tier 3 (pre-0470): plaintext tokens only.
        error = (
          await upsert({
            ...base,
            access_token: input.accessToken,
            refresh_token: input.refreshToken,
          })
        ).error;
      }
    }
    if (error) {
      if (isMissingSchema(error))
        return { ok: false, reason: "migration_pending" };
      console.error(
        "[quickbooks] upsertFirmQuickbooksConnection failed:",
        error,
      );
      return { ok: false, reason: "error" };
    }
    return { ok: true };
  };

  // PRIMARY (post-0710): ALWAYS conflict on (firm_id, client_id) with client_id
  // set — undefined ⇒ a firm-level row with client_id NULL, which NULLS NOT
  // DISTINCT conflict-matches an existing firm-level row. FALLBACK (pre-0710, the
  // client_id column is absent): the primary saw a missing-schema error on every
  // tier (→ migration_pending), so retry the legacy firm-only conflict target with
  // client_id omitted — but ONLY for a firm-level scope. For a specific client we
  // must NOT fall back (attempt({}, "firm_id") would OVERWRITE the firm's real
  // connection with the client's company); instead surface migration_pending so the
  // OAuth callback shows "finish setup". (A genuine plaintext refusal also returns
  // migration_pending; for firm-level the retry simply refuses again, unchanged.)
  const primary = await attempt(
    { client_id: clientId ?? null },
    "firm_id,client_id",
  );
  if (primary.ok || primary.reason !== "migration_pending") return primary;
  if (isFirmLevelScope(clientId)) return attempt({}, "firm_id");
  return primary;
}

// Self-heal the connected company's country (service role). Used by the sync job
// so a connection that predates the tax-line feature (or pre-0470) gets its
// country populated without a reconnect. Best-effort + graceful: a missing column
// (pre-0470) or error is swallowed. Only writes when `country` is non-null.
export async function updateFirmQuickbooksCompanyCountry(
  firmId: string,
  country: string | null,
  clientId?: QuickbooksClientScope,
): Promise<void> {
  if (!country) return;
  const sb = getServiceRoleSupabase();
  const base = () =>
    sb
      .from("quickbooks_connections")
      .update({ company_country: country })
      .eq("firm_id", firmId);
  const { error } = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId),
    () => base(),
  );
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
  clientId?: QuickbooksClientScope,
): Promise<boolean> {
  const sb = getServiceRoleSupabase();
  const base = () =>
    sb.from("quickbooks_connections").select("realm_id").eq("firm_id", firmId);
  const { data, error } = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId).maybeSingle(),
    () => base().maybeSingle(),
  );
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
  clientId?: QuickbooksClientScope,
): Promise<QuickbooksConnectionReadResult> {
  const sb = getServiceRoleSupabase();
  // Widest select first (0470 company_country); fall back to the pre-0470 column
  // set on a missing-column error so token refresh keeps working before the
  // migration lands.
  const selects = [
    "realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, company_country",
    "realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment",
  ] as const;
  // Runs the tiered select loop once. `scopeOn` narrows to the requested client
  // (0710) — undefined/null ⇒ client_id IS NULL, a uuid ⇒ that client. A missing
  // client_id column surfaces as a missing-schema error that the outer degrade
  // path retries with the original no-filter query.
  const readOnce = async (scopeOn: boolean) => {
    let data: Record<string, unknown> | null = null;
    let error: { code?: string; message?: string } | null = null;
    for (const sel of selects) {
      let q = sb
        .from("quickbooks_connections")
        .select(sel)
        .eq("firm_id", firmId);
      if (scopeOn) q = withClientScope(q, clientId);
      const res = await q.maybeSingle();
      if (res.error && isMissingSchema(res.error)) {
        error = res.error;
        continue;
      }
      data = res.data as Record<string, unknown> | null;
      error = res.error;
      break;
    }
    return { data, error };
  };
  // Always try the client-scoped read first. Degrade to the no-filter read only
  // when the client_id column is absent (pre-0710) AND the scope is firm-level —
  // that returns the single legacy row. For a specific client we must NOT fall
  // back (it would return the firm-level row); the missing-schema error stays and
  // maps to {kind:"absent"} below.
  let { data, error } = await readOnce(true);
  if (error && isMissingSchema(error) && isFirmLevelScope(clientId)) {
    ({ data, error } = await readOnce(false));
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
  clientId?: QuickbooksClientScope,
): Promise<QuickbooksConnectionWithTokens | null> {
  const res = await readFirmQuickbooksConnection(firmId, clientId);
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
  clientId?: QuickbooksClientScope,
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

  // One optimistic-update attempt. `scopeOn` adds the client_id filter to the
  // WHERE (the client_id column itself is never SET here — the row already carries
  // it). `schemaMiss` tells the caller the failure was a missing-schema error, so
  // a client-scoped attempt can degrade to firm-only when 0710 isn't applied yet.
  const run = async (
    scopeOn: boolean,
  ): Promise<{ result: UpdateTokensResult; schemaMiss: boolean }> => {
    const scope = <Q>(q: Q): Q => (scopeOn ? withClientScope(q, clientId) : q);

    // Primary path (0480): store ENCRYPTED tokens + the new fingerprint, and match
    // the old row by its fingerprint (identical whether the old token is stored
    // encrypted or as legacy plaintext — the fingerprint is always of the plaintext).
    let res = await scope(
      sb
        .from("quickbooks_connections")
        .update({
          ...commonPatch,
          access_token: maybeEncryptToken(tokens.accessToken),
          refresh_token: maybeEncryptToken(tokens.refreshToken),
          refresh_token_fingerprint: tokenFingerprint(tokens.refreshToken),
        })
        .eq("firm_id", firmId)
        .eq(
          "refresh_token_fingerprint",
          tokenFingerprint(expectedRefreshToken),
        ),
    ).select("id");

    if (res.error && isMissingSchema(res.error)) {
      // Same plaintext-refusal rule as the upsert: with an encryption key
      // configured, never write plaintext tokens just because 0480 is missing.
      // "error" makes the caller discard the rotation (the connection degrades
      // gracefully) instead of silently downgrading to plaintext at rest.
      if (isTokenEncryptionConfigured()) {
        console.error(
          "[quickbooks] refusing plaintext token rotation: QBO_TOKEN_ENC_KEY is set but migration 0480 is not applied",
        );
        return { result: { outcome: "error" }, schemaMiss: true };
      }
      // Pre-0480: no fingerprint column. Store PLAINTEXT (so encryption isn't left
      // un-matchable) and match on the raw refresh token, exactly as before.
      res = await scope(
        sb
          .from("quickbooks_connections")
          .update({
            ...commonPatch,
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
          })
          .eq("firm_id", firmId)
          .eq("refresh_token", expectedRefreshToken),
      ).select("id");
    }

    if (res.error) {
      if (!isMissingSchema(res.error)) {
        console.error(
          "[quickbooks] updateFirmQuickbooksTokens failed:",
          res.error,
        );
        return { result: { outcome: "error" }, schemaMiss: false };
      }
      return { result: { outcome: "error" }, schemaMiss: true };
    }
    return {
      result:
        res.data && res.data.length > 0
          ? { outcome: "updated" }
          : { outcome: "raced" },
      schemaMiss: false,
    };
  };

  // Always scope the WHERE first (undefined/null ⇒ client_id IS NULL, a uuid ⇒
  // that client). A missing-schema error means the client_id column (0710) isn't
  // there yet → degrade to the original no-filter optimistic update ONLY for a
  // firm-level scope. For a specific client, do NOT fall back (it would rotate the
  // firm row's tokens); return the scoped "error" so the caller discards the
  // rotation (that client simply has no connection yet, pre-0710).
  const scoped = await run(true);
  if (
    scoped.result.outcome === "error" &&
    scoped.schemaMiss &&
    isFirmLevelScope(clientId)
  ) {
    return (await run(false)).result;
  }
  return scoped.result;
}

// Remove the firm's connection entirely (disconnect). Service-role delete. Safe
// to call when nothing exists (no-op) or before the migration is applied.
export async function clearFirmQuickbooksConnection(
  firmId: string,
  clientId?: QuickbooksClientScope,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const base = () =>
    sb.from("quickbooks_connections").delete().eq("firm_id", firmId);
  const { error } = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId),
    () => base(),
  );
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
  clientId?: QuickbooksClientScope,
): Promise<{ realmId: string; environment: QuickbooksEnvironment } | null> {
  const sb = getServiceRoleSupabase();
  const base = () =>
    sb
      .from("quickbooks_connections")
      .select("realm_id, environment")
      .eq("firm_id", firmId);
  const { data, error } = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId).maybeSingle(),
    () => base().maybeSingle(),
  );
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

// Every stored connection to a given Intuit company (realm), ACROSS ALL FIRMS —
// service-role read for the client-list import flow. Intuit token revocation
// kills the whole app↔realm grant, so before the import releases its transient
// tokens it must know whether ANY stored connection would die with them.
// Returns [] on any error / pre-migration (callers then err on the safe side —
// with an empty result the import still revokes, which is only wrong if a
// connection actually existed, and that case returns rows).
export async function findQuickbooksConnectionsByRealm(
  realmId: string,
  environment: QuickbooksEnvironment,
): Promise<{ firmId: string; clientId: string | null }[]> {
  const sb = getServiceRoleSupabase();
  const run = (withClient: boolean) =>
    sb
      .from("quickbooks_connections")
      .select(withClient ? "firm_id, client_id" : "firm_id")
      .eq("realm_id", realmId)
      .eq("environment", environment);
  let { data, error } = await run(true);
  if (error && isMissingSchema(error)) {
    ({ data, error } = await run(false)); // pre-0710: no client_id column
  }
  if (error) {
    if (!isMissingSchema(error)) {
      console.error(
        "[quickbooks] findQuickbooksConnectionsByRealm failed:",
        error,
      );
    }
    return [];
  }
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    firmId: r.firm_id as string,
    clientId: (r.client_id as string | null) ?? null,
  }));
}
