// QuickBooks connection orchestration — token refresh.
//
// Ties the OAuth client (refresh) to the data layer (read/persist tokens). This
// is the single entry point every future stage will call to get a usable access
// token; Stage 1 uses it only to keep the connection alive + to verify it.

import {
  getFirmQuickbooksConnectionWithTokens,
  getFirmQuickbooksStatus,
  readFirmQuickbooksConnection,
  updateFirmQuickbooksTokens,
} from "@/lib/db/quickbooks";
import {
  refreshTokens,
  isAccessTokenStale,
  QuickbooksError,
  type QuickbooksEnvironment,
} from "@/lib/quickbooks/client";

// The result of trying to obtain a usable access token: the token itself (or
// null), plus whether the connection is DEAD — i.e. only a reconnect can fix it
// (invalid_grant: the refresh token expired after ~100 days of disuse, or the
// customer revoked access on Intuit's side). A transient failure (network, 5xx,
// persist race) is NOT dead — it may succeed on the next call.
type TokenAcquisition = { token: string | null; dead: boolean };

async function acquireValidAccessToken(
  firmId: string,
  opts?: { force?: boolean; clientId?: string | null },
): Promise<TokenAcquisition> {
  const clientId = opts?.clientId;
  const read = await readFirmQuickbooksConnection(firmId, clientId);
  // A transient DB/network failure reading the row is NOT a dead connection —
  // report it like any other transient miss so no false reconnect alarm shows.
  if (read.kind === "read_error") return { token: null, dead: false };
  // No row, pre-migration, or stored tokens that can't be decrypted: unusable
  // without a reconnect.
  if (read.kind === "absent") return { token: null, dead: true };
  const conn = read.conn;

  // `force` skips the staleness short-circuit: used after a data call returned
  // 401 even though our clock said the access token was still fresh (the customer
  // likely revoked access on Intuit's side), so we must refresh to find out
  // whether the grant is truly dead rather than trust the cached token.
  if (!opts?.force && !isAccessTokenStale(conn.accessTokenExpiresAt, Date.now())) {
    return { token: conn.accessToken, dead: false };
  }

  try {
    const fresh = await refreshTokens(conn.refreshToken);
    // Persist BOTH tokens with optimistic concurrency (Intuit rotates the refresh
    // token, so the old one may already be invalid).
    const result = await updateFirmQuickbooksTokens(
      firmId,
      conn.refreshToken,
      {
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        accessTokenExpiresAt: fresh.accessTokenExpiresAt,
        refreshTokenExpiresAt: fresh.refreshTokenExpiresAt,
      },
      clientId,
    );
    if (result.outcome === "updated")
      return { token: fresh.accessToken, dead: false };
    if (result.outcome === "raced") {
      // A concurrent refresh already rotated + stored the token. Use the stored
      // (valid) access token rather than ours, which may already be superseded.
      const latest = await getFirmQuickbooksConnectionWithTokens(firmId, clientId);
      return { token: latest?.accessToken ?? null, dead: false };
    }
    // "error": the rotated refresh token was NOT durably stored. Do NOT hand out
    // our access token — the next refresh would use a dead refresh token and the
    // connection would silently break.
    console.error(
      "[quickbooks] could not persist refreshed tokens; discarding to avoid a broken connection",
    );
    return { token: null, dead: false };
  } catch (e) {
    // invalid_grant = the connection is dead (refresh token expired/revoked). We
    // deliberately do NOT auto-delete here: a transient failure must not wipe a
    // connection, and the owner can disconnect/reconnect explicitly.
    if (e instanceof QuickbooksError) {
      console.error("[quickbooks] refresh failed:", e.code, e.message);
      return { token: null, dead: e.code === "invalid_grant" };
    }
    console.error("[quickbooks] refresh unexpected error:", e);
    return { token: null, dead: false };
  }
}

// Return a valid access token for the firm's QuickBooks connection, refreshing
// (and persisting the ROTATED tokens) when the current one is stale. Returns null
// when not connected, not configured, or the refresh fails.
export async function getValidAccessToken(
  firmId: string,
  clientId?: string | null,
): Promise<string | null> {
  return (await acquireValidAccessToken(firmId, { clientId })).token;
}

// Force a token refresh after a data/write call returned 401 despite our clock
// saying the access token was still fresh (typically the customer revoked
// Vylan's access inside QuickBooks). Returns `dead: true` when the refresh is
// itself rejected (invalid_grant) — the connection needs a reconnect — or a
// fresh token when it was only a spurious 401. Never throws.
export async function refreshAccessTokenAfter401(
  firmId: string,
  clientId?: string | null,
): Promise<TokenAcquisition> {
  try {
    return await acquireValidAccessToken(firmId, { force: true, clientId });
  } catch {
    return { token: null, dead: false };
  }
}

// Health of an EXISTING connection, for surfacing a "reconnect QuickBooks"
// banner. Only meaningful when the caller has already seen a connection row
// (getFirmQuickbooksStatus). "reconnect_required" means no token can be obtained
// AND retrying won't help (dead refresh token, revoked access, or undecryptable
// stored tokens) — the owner must click Connect again. Transient failures report
// "ok" so a network blip never shows a false alarm. As a side effect this
// refreshes a stale token, so it doubles as the Settings keep-alive.
export type QuickbooksConnectionHealth = "ok" | "reconnect_required";

export async function getQuickbooksConnectionHealth(
  firmId: string,
  clientId?: string | null,
): Promise<QuickbooksConnectionHealth> {
  try {
    const { token, dead } = await acquireValidAccessToken(firmId, { clientId });
    if (token) return "ok";
    return dead ? "reconnect_required" : "ok";
  } catch {
    // Never let a health check break a page render.
    return "ok";
  }
}

// Queue-page variant of the health check: additionally distinguishes a MISSING
// connection ("not_connected" — the scope has no row at all: never connected, or
// disconnected after its drafts were made) from a DEAD one ("reconnect_required"
// — a row exists but its grant is expired/revoked/unreadable). The plain
// getQuickbooksConnectionHealth above keeps mapping both to "reconnect_required"
// for callers that have already verified a row exists (Settings, client page).
// The row-existence read runs only in the dead path, so the healthy path costs
// nothing extra. Uses the AUTHENTICATED client for that read — page/RSC only.
export type QuickbooksScopeHealth =
  | QuickbooksConnectionHealth
  | "not_connected";

export async function getQuickbooksScopeHealth(
  firmId: string,
  clientId?: string | null,
): Promise<QuickbooksScopeHealth> {
  const health = await getQuickbooksConnectionHealth(firmId, clientId);
  if (health !== "reconnect_required") return health;
  try {
    const status = await getFirmQuickbooksStatus(clientId);
    return status ? "reconnect_required" : "not_connected";
  } catch {
    // If the existence read itself fails, keep the stronger warning.
    return "reconnect_required";
  }
}

export type QuickbooksReadContext = {
  accessToken: string;
  realmId: string;
  environment: QuickbooksEnvironment;
  // The connected company's country (e.g. "US", "CA"); null before it's been
  // back-filled (pre-0470 or a connection that predates the tax-line feature).
  // Posting uses it to decide whether to send the non-US GlobalTaxCalculation.
  companyCountry: string | null;
};

// Everything a read/post needs for a firm, together: a fresh access token + the
// realm id + the per-connection environment (which selects the API base URL) +
// the company country. Returns null when the firm is not connected / not
// configured / the token cannot be refreshed.
export async function getQuickbooksReadContext(
  firmId: string,
  clientId?: string | null,
): Promise<QuickbooksReadContext | null> {
  const conn = await getFirmQuickbooksConnectionWithTokens(firmId, clientId);
  if (!conn) return null;
  const accessToken = await getValidAccessToken(firmId, clientId);
  if (!accessToken) return null;
  return {
    accessToken,
    realmId: conn.realmId,
    environment: conn.environment,
    companyCountry: conn.companyCountry,
  };
}

