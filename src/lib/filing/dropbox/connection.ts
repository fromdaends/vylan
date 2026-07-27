// Dropbox connection orchestration — token acquisition for the engine.
// Mirrors google/connection.ts. Dropbox refresh tokens are long-lived and
// non-rotating, so the fallback-to-current on refresh is the common path.

import {
  markStorageConnectionError,
  readActiveConnectionTokens,
  updateStorageConnectionTokens,
} from "@/lib/db/filing";
import type { ConnectorContext } from "@/lib/filing/types";
import {
  DropboxOauthError,
  isDropboxAccessTokenStale,
  refreshDropboxTokens,
} from "./oauth";

export type DropboxAcquisition =
  | { kind: "ok"; ctx: ConnectorContext; connectionId: string }
  | { kind: "dead" }
  | { kind: "unavailable" };

export async function acquireDropboxConnectorContext(
  firmId: string,
): Promise<DropboxAcquisition> {
  const read = await readActiveConnectionTokens(firmId);
  if (read.kind === "read_error") return { kind: "unavailable" };
  if (read.kind === "absent" || read.conn.provider !== "dropbox") {
    return { kind: "dead" };
  }
  const conn = read.conn;

  if (!isDropboxAccessTokenStale(conn.accessTokenExpiresAt, Date.now())) {
    return {
      kind: "ok",
      ctx: { accessToken: conn.accessToken, config: conn.config },
      connectionId: conn.id,
    };
  }

  try {
    const fresh = await refreshDropboxTokens(conn.refreshToken);
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
    return {
      kind: "ok",
      ctx: { accessToken: fresh.accessToken, config: conn.config },
      connectionId: conn.id,
    };
  } catch (e) {
    if (e instanceof DropboxOauthError && e.dead) {
      await markStorageConnectionError(firmId);
      return { kind: "dead" };
    }
    console.error("[filing] dropbox token refresh failed:", (e as Error).message);
    return { kind: "unavailable" };
  }
}
