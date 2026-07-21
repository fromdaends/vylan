// Xero connection orchestration — token refresh + health, per client.
//
// Mirrors src/lib/quickbooks/connection.ts with Xero's sharper constraints:
// access tokens live ~30 minutes (vs Intuit's ~60) and refresh tokens are
// SINGLE-USE rotating with a 30-minute grace window — so persisting BOTH
// tokens atomically (fingerprint optimistic lock) is what keeps a connection
// alive, and a lost rotation must be discarded, never handed out.

import {
  readClientXeroConnection,
  updateClientXeroTokens,
} from "@/lib/db/xero";
import {
  refreshXeroTokens,
  isXeroAccessTokenStale,
  XeroError,
} from "@/lib/xero/client";

// The token itself (or null), plus whether the connection is DEAD — only a
// reconnect can fix it (invalid_grant: the refresh token expired after 60 days
// of disuse, was revoked in Xero, or rotated away past its grace window). A
// transient failure (network, 5xx, persist race) is NOT dead.
export type XeroTokenAcquisition = { token: string | null; dead: boolean };

async function acquireValidXeroAccessToken(
  firmId: string,
  clientId: string,
  opts?: { force?: boolean },
): Promise<XeroTokenAcquisition> {
  const read = await readClientXeroConnection(firmId, clientId);
  // A transient DB failure is not a dead connection — no false reconnect alarm.
  if (read.kind === "read_error") return { token: null, dead: false };
  // No row / pre-migration / undecryptable tokens: unusable without reconnect.
  if (read.kind === "absent") return { token: null, dead: true };
  const conn = read.conn;

  if (
    !opts?.force &&
    !isXeroAccessTokenStale(conn.accessTokenExpiresAt, Date.now())
  ) {
    return { token: conn.accessToken, dead: false };
  }

  try {
    const fresh = await refreshXeroTokens(conn.refreshToken);
    const result = await updateClientXeroTokens(
      firmId,
      clientId,
      conn.refreshToken,
      {
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        accessTokenExpiresAt: fresh.accessTokenExpiresAt,
        refreshTokenExpiresAt: fresh.refreshTokenExpiresAt,
      },
    );
    if (result.outcome === "updated") {
      return { token: fresh.accessToken, dead: false };
    }
    if (result.outcome === "raced") {
      // A concurrent refresh already rotated + stored newer tokens; use those.
      const latest = await readClientXeroConnection(firmId, clientId);
      return {
        token: latest.kind === "ok" ? latest.conn.accessToken : null,
        dead: false,
      };
    }
    // "error": the rotation was NOT durably stored. Discard it — handing out
    // this access token while the stored refresh token is already superseded
    // (single-use!) would silently kill the connection ~30 minutes later.
    console.error(
      "[xero] could not persist refreshed tokens; discarding to avoid a broken connection",
    );
    return { token: null, dead: false };
  } catch (e) {
    if (e instanceof XeroError) {
      console.error("[xero] refresh failed:", e.code, e.message);
      return { token: null, dead: e.code === "invalid_grant" };
    }
    console.error("[xero] refresh unexpected error:", e);
    return { token: null, dead: false };
  }
}

// A valid access token for the client's Xero connection, refreshing (and
// persisting the rotation) when stale. Null when not connected / refresh fails.
export async function getValidXeroAccessToken(
  firmId: string,
  clientId: string,
): Promise<string | null> {
  return (await acquireValidXeroAccessToken(firmId, clientId)).token;
}

// Health of an EXISTING connection, for the client card's "reconnect" state.
// "reconnect_required" = no token obtainable AND retrying won't help. Transient
// failures report "ok" so a blip never shows a false alarm. Doubles as the
// keep-alive: rendering the client page refreshes a stale token, which resets
// Xero's 60-day idle clock.
export type XeroConnectionHealth = "ok" | "reconnect_required";

export async function getXeroConnectionHealth(
  firmId: string,
  clientId: string,
): Promise<XeroConnectionHealth> {
  try {
    const { token, dead } = await acquireValidXeroAccessToken(firmId, clientId);
    if (token) return "ok";
    return dead ? "reconnect_required" : "ok";
  } catch {
    return "ok"; // never break a page render on a health check
  }
}

// Everything a Xero read/write needs, together: a fresh access token + the org
// (tenant) id for the Xero-tenant-id header. Null when not connected. The
// foundation the later cache-sync + posting phases build on.
export type XeroReadContext = {
  accessToken: string;
  tenantId: string;
};

export async function getXeroReadContext(
  firmId: string,
  clientId: string,
): Promise<XeroReadContext | null> {
  const read = await readClientXeroConnection(firmId, clientId);
  if (read.kind !== "ok") return null;
  const accessToken = await getValidXeroAccessToken(firmId, clientId);
  if (!accessToken) return null;
  return { accessToken, tenantId: read.conn.tenantId };
}
