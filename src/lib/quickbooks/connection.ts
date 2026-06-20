// QuickBooks connection orchestration — token refresh.
//
// Ties the OAuth client (refresh) to the data layer (read/persist tokens). This
// is the single entry point every future stage will call to get a usable access
// token; Stage 1 uses it only to keep the connection alive + to verify it.

import {
  getFirmQuickbooksConnectionWithTokens,
  updateFirmQuickbooksTokens,
} from "@/lib/db/quickbooks";
import {
  refreshTokens,
  isAccessTokenStale,
  QuickbooksError,
} from "@/lib/quickbooks/client";

// Return a valid access token for the firm's QuickBooks connection, refreshing
// (and persisting the ROTATED tokens) when the current one is stale. Returns null
// when not connected, not configured, or the refresh fails.
export async function getValidAccessToken(
  firmId: string,
): Promise<string | null> {
  const conn = await getFirmQuickbooksConnectionWithTokens(firmId);
  if (!conn) return null;

  if (!isAccessTokenStale(conn.accessTokenExpiresAt, Date.now())) {
    return conn.accessToken;
  }

  try {
    const fresh = await refreshTokens(conn.refreshToken);
    // Persist BOTH tokens with optimistic concurrency (Intuit rotates the refresh
    // token, so the old one may already be invalid).
    const result = await updateFirmQuickbooksTokens(firmId, conn.refreshToken, {
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken,
      accessTokenExpiresAt: fresh.accessTokenExpiresAt,
      refreshTokenExpiresAt: fresh.refreshTokenExpiresAt,
    });
    if (result.outcome === "updated") return fresh.accessToken;
    if (result.outcome === "raced") {
      // A concurrent refresh already rotated + stored the token. Use the stored
      // (valid) access token rather than ours, which may already be superseded.
      const latest = await getFirmQuickbooksConnectionWithTokens(firmId);
      return latest?.accessToken ?? null;
    }
    // "error": the rotated refresh token was NOT durably stored. Do NOT hand out
    // our access token — the next refresh would use a dead refresh token and the
    // connection would silently break.
    console.error(
      "[quickbooks] could not persist refreshed tokens; discarding to avoid a broken connection",
    );
    return null;
  } catch (e) {
    // invalid_grant = the connection is dead (refresh token expired/revoked). We
    // deliberately do NOT auto-delete here: a transient failure must not wipe a
    // connection, and the owner can disconnect/reconnect explicitly.
    if (e instanceof QuickbooksError) {
      console.error("[quickbooks] refresh failed:", e.code, e.message);
    } else {
      console.error("[quickbooks] refresh unexpected error:", e);
    }
    return null;
  }
}

// Best-effort keep-alive used when the owner opens Settings: refreshes only when
// the access token is stale, so a dormant connection stays alive. Never throws
// and never blocks rendering on a failure.
export async function ensureFreshQuickbooksToken(firmId: string): Promise<void> {
  try {
    await getValidAccessToken(firmId);
  } catch {
    // Swallow — this is purely a keep-alive; the page renders regardless.
  }
}
