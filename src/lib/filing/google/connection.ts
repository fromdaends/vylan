// Google Drive connection orchestration — token acquisition for the engine.
//
// The single entry point the filing runner (Phase 4) calls to get a usable
// ConnectorContext. Mirrors the proven QuickBooks connection.ts: refresh when
// stale, persist with optimistic concurrency (fingerprint match), and report
// DEAD (reconnect required) only on invalid_grant — transient failures stay
// transient so no false "reconnect" alarms.

import {
  markStorageConnectionError,
  readActiveConnectionTokens,
  updateStorageConnectionTokens,
} from "@/lib/db/filing";
import type { ConnectorContext } from "@/lib/filing/types";
import {
  GoogleOauthError,
  isGoogleAccessTokenStale,
  refreshGoogleTokens,
} from "./oauth";

export type GoogleAcquisition =
  | { kind: "ok"; ctx: ConnectorContext; connectionId: string }
  // Only a reconnect can fix it (revoked / expired grant). The connection row
  // has been flagged status='error' so the UI shows the reconnect prompt.
  | { kind: "dead" }
  // Transient (network, 5xx, lost refresh race) — retry later, no flag.
  | { kind: "unavailable" };

export async function acquireGoogleConnectorContext(
  firmId: string,
): Promise<GoogleAcquisition> {
  const read = await readActiveConnectionTokens(firmId);
  if (read.kind === "read_error") return { kind: "unavailable" };
  if (read.kind === "absent" || read.conn.provider !== "google_drive") {
    return { kind: "dead" };
  }
  const conn = read.conn;

  if (!isGoogleAccessTokenStale(conn.accessTokenExpiresAt, Date.now())) {
    return {
      kind: "ok",
      ctx: { accessToken: conn.accessToken, config: conn.config },
      connectionId: conn.id,
    };
  }

  try {
    const fresh = await refreshGoogleTokens(conn.refreshToken);
    // Google usually keeps the refresh token; fall back to the current one.
    const nextRefresh = fresh.refreshToken ?? conn.refreshToken;
    const persisted = await updateStorageConnectionTokens(
      firmId,
      conn.refreshToken,
      {
        accessToken: fresh.accessToken,
        refreshToken: nextRefresh,
        accessTokenExpiresAt: fresh.accessTokenExpiresAt,
      },
    );
    if (persisted === "stale") {
      // A concurrent refresh won; use ITS stored tokens on the next read.
      const reread = await readActiveConnectionTokens(firmId);
      if (reread.kind === "ok") {
        return {
          kind: "ok",
          ctx: {
            accessToken: reread.conn.accessToken,
            config: reread.conn.config,
          },
          connectionId: reread.conn.id,
        };
      }
      return { kind: "unavailable" };
    }
    // "error" persisting is transient — the fresh token is still valid for
    // THIS run; next run refreshes again.
    return {
      kind: "ok",
      ctx: { accessToken: fresh.accessToken, config: conn.config },
      connectionId: conn.id,
    };
  } catch (e) {
    if (e instanceof GoogleOauthError && e.dead) {
      await markStorageConnectionError(firmId);
      return { kind: "dead" };
    }
    console.error("[filing] google token refresh failed:", (e as Error).message);
    return { kind: "unavailable" };
  }
}
