import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuickbooksConnectionWithTokens } from "@/lib/db/quickbooks";

// Mock the DB layer (service-role) and the network refresh, keeping the rest of
// the client real (isAccessTokenStale + QuickbooksError must stay genuine).
vi.mock("@/lib/db/quickbooks", () => ({
  getFirmQuickbooksConnectionWithTokens: vi.fn(),
  getFirmQuickbooksStatus: vi.fn(),
  readFirmQuickbooksConnection: vi.fn(),
  updateFirmQuickbooksTokens: vi.fn(),
}));
vi.mock("@/lib/quickbooks/client", async (importActual) => {
  const actual = await importActual<typeof import("./client")>();
  return { ...actual, refreshTokens: vi.fn() };
});

import {
  getValidAccessToken,
  getQuickbooksConnectionHealth,
  getQuickbooksScopeHealth,
  refreshAccessTokenAfter401,
} from "./connection";
import {
  getFirmQuickbooksConnectionWithTokens,
  getFirmQuickbooksStatus,
  readFirmQuickbooksConnection,
  updateFirmQuickbooksTokens,
} from "@/lib/db/quickbooks";
import { refreshTokens, QuickbooksError } from "@/lib/quickbooks/client";

const mockGetConn = vi.mocked(getFirmQuickbooksConnectionWithTokens);
const mockStatus = vi.mocked(getFirmQuickbooksStatus);
const mockRead = vi.mocked(readFirmQuickbooksConnection);
const mockUpdate = vi.mocked(updateFirmQuickbooksTokens);
const mockRefresh = vi.mocked(refreshTokens);

// Rich read-result helpers (the primary read path).
const okRead = (c: QuickbooksConnectionWithTokens) =>
  ({ kind: "ok", conn: c }) as const;
const ABSENT = { kind: "absent" } as const;
const READ_ERROR = { kind: "read_error" } as const;

const FRESH = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
const STALE = new Date(Date.now() - 1000).toISOString(); // expired

function conn(
  overrides: Partial<QuickbooksConnectionWithTokens> = {},
): QuickbooksConnectionWithTokens {
  return {
    realmId: "realm1",
    accessToken: "AT",
    refreshToken: "RT",
    accessTokenExpiresAt: FRESH,
    refreshTokenExpiresAt: null,
    environment: "sandbox",
    companyCountry: null,
    ...overrides,
  };
}

const FRESH_TOKENS = {
  accessToken: "AT2",
  refreshToken: "RT2",
  accessTokenExpiresAt: FRESH,
  refreshTokenExpiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getValidAccessToken", () => {
  it("returns null and never refreshes when there is no connection", async () => {
    mockRead.mockResolvedValue(ABSENT);
    expect(await getValidAccessToken("f1")).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("returns null (without refreshing) when the connection read errors transiently", async () => {
    mockRead.mockResolvedValue(READ_ERROR);
    expect(await getValidAccessToken("f1")).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("returns the stored token without refreshing when it is still fresh", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: FRESH })));
    expect(await getValidAccessToken("f1")).toBe("AT");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refreshes a stale token and returns the new one on a successful persist", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "updated" });
    expect(await getValidAccessToken("f1")).toBe("AT2");
    // Optimistic concurrency: persist is guarded on the OLD refresh token. The
    // 4th arg (clientId) is undefined here — a firm-level refresh.
    expect(mockUpdate).toHaveBeenCalledWith(
      "f1",
      "RT",
      expect.objectContaining({ accessToken: "AT2", refreshToken: "RT2" }),
      undefined,
    );
  });

  it("re-reads and uses the stored token when a concurrent refresh won the race", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    // The raced-path re-read goes through the plain wrapper.
    mockGetConn.mockResolvedValue(
      conn({ accessToken: "AT_WINNER", accessTokenExpiresAt: FRESH }),
    );
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "raced" });
    expect(await getValidAccessToken("f1")).toBe("AT_WINNER");
  });

  it("returns null (discards the token) when the rotated token could not be persisted", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "error" });
    // Must NOT return AT2 — the rotated refresh token was not durably stored, so
    // using its access token would break the next refresh.
    expect(await getValidAccessToken("f1")).toBeNull();
  });

  it("returns null when the refresh token is dead (invalid_grant)", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockRejectedValue(new QuickbooksError("invalid_grant", "dead"));
    expect(await getValidAccessToken("f1")).toBeNull();
  });
});

describe("getQuickbooksConnectionHealth", () => {
  it("is ok when the stored token is still fresh (no refresh attempted)", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: FRESH })));
    expect(await getQuickbooksConnectionHealth("f1")).toBe("ok");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("is ok when a stale token refreshes successfully (doubles as keep-alive)", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "updated" });
    expect(await getQuickbooksConnectionHealth("f1")).toBe("ok");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("requires reconnect when the refresh token is dead (invalid_grant)", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockRejectedValue(new QuickbooksError("invalid_grant", "dead"));
    expect(await getQuickbooksConnectionHealth("f1")).toBe(
      "reconnect_required",
    );
  });

  it("requires reconnect when the stored tokens are unreadable (absent)", async () => {
    // A connection row the caller can SEE exists, but whose tokens can't be
    // decrypted (or the row vanished), reads back as absent — only a reconnect
    // fixes that.
    mockRead.mockResolvedValue(ABSENT);
    expect(await getQuickbooksConnectionHealth("f1")).toBe(
      "reconnect_required",
    );
  });

  it("stays ok on a TRANSIENT connection-read failure — no false alarm", async () => {
    // A one-off DB/network blip reading the row must NOT flash the reconnect
    // banner for a perfectly healthy connection.
    mockRead.mockResolvedValue(READ_ERROR);
    expect(await getQuickbooksConnectionHealth("f1")).toBe("ok");
  });

  it("stays ok on a TRANSIENT refresh failure (network/5xx) — no false alarm", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockRejectedValue(
      new QuickbooksError("token_refresh_failed", "503 upstream", 503),
    );
    expect(await getQuickbooksConnectionHealth("f1")).toBe("ok");
  });

  it("stays ok when the refreshed tokens could not be persisted (transient)", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "error" });
    expect(await getQuickbooksConnectionHealth("f1")).toBe("ok");
  });
});

// Queue-page variant: a MISSING connection (no row for the scope) must read as
// "not_connected" — the queue shows a soft "connect this client" notice — while
// a row whose grant is dead keeps the stronger "reconnect_required".
describe("getQuickbooksScopeHealth", () => {
  const CONNECTED_STATUS = {
    connected: true as const,
    realmId: "realm1",
    companyName: "Co",
    environment: "sandbox" as const,
    connectedAt: "2026-01-01T00:00:00Z",
  };

  it("is ok when a token is available — no existence read at all", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: FRESH })));
    expect(await getQuickbooksScopeHealth("f1", "c1")).toBe("ok");
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it("is not_connected when the scope has no connection row", async () => {
    mockRead.mockResolvedValue(ABSENT);
    mockStatus.mockResolvedValue(null);
    expect(await getQuickbooksScopeHealth("f1", "c1")).toBe("not_connected");
    expect(mockStatus).toHaveBeenCalledWith("c1");
  });

  it("requires reconnect when a row exists but the grant is dead", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: STALE })));
    mockRefresh.mockRejectedValue(new QuickbooksError("invalid_grant", "dead"));
    mockStatus.mockResolvedValue(CONNECTED_STATUS);
    expect(await getQuickbooksScopeHealth("f1", "c1")).toBe(
      "reconnect_required",
    );
  });

  it("requires reconnect when a row exists but its tokens are unreadable", async () => {
    mockRead.mockResolvedValue(ABSENT); // decrypt failure reads back as absent
    mockStatus.mockResolvedValue(CONNECTED_STATUS);
    expect(await getQuickbooksScopeHealth("f1", "c1")).toBe(
      "reconnect_required",
    );
  });

  it("keeps the stronger warning when the existence read itself fails", async () => {
    mockRead.mockResolvedValue(ABSENT);
    mockStatus.mockRejectedValue(new Error("db down"));
    expect(await getQuickbooksScopeHealth("f1", "c1")).toBe(
      "reconnect_required",
    );
  });
});

// Used by the post path when a create returned 401 despite a fresh-by-our-clock
// token: force a refresh to tell a spurious 401 (refresh ok) from a revoked
// grant (invalid_grant → the accountant must reconnect).
describe("refreshAccessTokenAfter401", () => {
  it("forces a refresh even when the stored token still looks fresh", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: FRESH })));
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "updated" });
    const r = await refreshAccessTokenAfter401("f1");
    // getValidAccessToken would have trusted the fresh token; this must refresh.
    expect(mockRefresh).toHaveBeenCalled();
    expect(r).toEqual({ token: "AT2", dead: false });
  });

  it("reports dead when the forced refresh is rejected (invalid_grant)", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: FRESH })));
    mockRefresh.mockRejectedValue(new QuickbooksError("invalid_grant", "dead"));
    expect(await refreshAccessTokenAfter401("f1")).toEqual({
      token: null,
      dead: true,
    });
  });

  it("reports NOT dead on a transient refresh failure (5xx) — no false reconnect", async () => {
    mockRead.mockResolvedValue(okRead(conn({ accessTokenExpiresAt: FRESH })));
    mockRefresh.mockRejectedValue(
      new QuickbooksError("token_refresh_failed", "503 upstream", 503),
    );
    expect(await refreshAccessTokenAfter401("f1")).toEqual({
      token: null,
      dead: false,
    });
  });
});
