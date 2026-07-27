// Microsoft connection orchestration — token acquisition for the engine and
// the destination picker. Mirrors google/connection.ts: refresh when stale,
// persist with fingerprint-matched optimistic concurrency, report DEAD only
// on invalid_grant. Microsoft ROTATES the refresh token on every refresh, so
// persisting the returned one is not optional here — a lost rotation strands
// the connection (the fingerprint match + re-read below handle the races).

import {
  markStorageConnectionError,
  readActiveConnectionTokens,
  updateStorageConnectionTokens,
} from "@/lib/db/filing";
import type { ConnectorContext } from "@/lib/filing/types";
import {
  MicrosoftOauthError,
  isMicrosoftAccessTokenStale,
  refreshMicrosoftTokens,
} from "./oauth";

export type MicrosoftAcquisition =
  | { kind: "ok"; ctx: ConnectorContext; connectionId: string }
  | { kind: "dead" }
  | { kind: "unavailable" };

export async function acquireMicrosoftConnectorContext(
  firmId: string,
): Promise<MicrosoftAcquisition> {
  const read = await readActiveConnectionTokens(firmId);
  if (read.kind === "read_error") return { kind: "unavailable" };
  if (read.kind === "absent" || read.conn.provider !== "microsoft") {
    return { kind: "dead" };
  }
  const conn = read.conn;

  if (!isMicrosoftAccessTokenStale(conn.accessTokenExpiresAt, Date.now())) {
    return {
      kind: "ok",
      ctx: { accessToken: conn.accessToken, config: conn.config },
      connectionId: conn.id,
    };
  }

  try {
    const fresh = await refreshMicrosoftTokens(conn.refreshToken);
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
      // A concurrent refresh won and stored the newer rotation; use it.
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
    if (e instanceof MicrosoftOauthError && e.dead) {
      await markStorageConnectionError(firmId);
      return { kind: "dead" };
    }
    console.error(
      "[filing] microsoft token refresh failed:",
      (e as Error).message,
    );
    return { kind: "unavailable" };
  }
}
