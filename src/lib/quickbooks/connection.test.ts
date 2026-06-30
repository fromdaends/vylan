import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuickbooksConnectionWithTokens } from "@/lib/db/quickbooks";

// Mock the DB layer (service-role) and the network refresh, keeping the rest of
// the client real (isAccessTokenStale + QuickbooksError must stay genuine).
vi.mock("@/lib/db/quickbooks", () => ({
  getFirmQuickbooksConnectionWithTokens: vi.fn(),
  updateFirmQuickbooksTokens: vi.fn(),
}));
vi.mock("@/lib/quickbooks/client", async (importActual) => {
  const actual = await importActual<typeof import("./client")>();
  return { ...actual, refreshTokens: vi.fn() };
});

import { getValidAccessToken } from "./connection";
import {
  getFirmQuickbooksConnectionWithTokens,
  updateFirmQuickbooksTokens,
} from "@/lib/db/quickbooks";
import { refreshTokens, QuickbooksError } from "@/lib/quickbooks/client";

const mockGetConn = vi.mocked(getFirmQuickbooksConnectionWithTokens);
const mockUpdate = vi.mocked(updateFirmQuickbooksTokens);
const mockRefresh = vi.mocked(refreshTokens);

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
    mockGetConn.mockResolvedValue(null);
    expect(await getValidAccessToken("f1")).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("returns the stored token without refreshing when it is still fresh", async () => {
    mockGetConn.mockResolvedValue(conn({ accessTokenExpiresAt: FRESH }));
    expect(await getValidAccessToken("f1")).toBe("AT");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refreshes a stale token and returns the new one on a successful persist", async () => {
    mockGetConn.mockResolvedValue(conn({ accessTokenExpiresAt: STALE }));
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "updated" });
    expect(await getValidAccessToken("f1")).toBe("AT2");
    // Optimistic concurrency: persist is guarded on the OLD refresh token.
    expect(mockUpdate).toHaveBeenCalledWith(
      "f1",
      "RT",
      expect.objectContaining({ accessToken: "AT2", refreshToken: "RT2" }),
    );
  });

  it("re-reads and uses the stored token when a concurrent refresh won the race", async () => {
    mockGetConn
      .mockResolvedValueOnce(conn({ accessTokenExpiresAt: STALE }))
      .mockResolvedValueOnce(
        conn({ accessToken: "AT_WINNER", accessTokenExpiresAt: FRESH }),
      );
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "raced" });
    expect(await getValidAccessToken("f1")).toBe("AT_WINNER");
  });

  it("returns null (discards the token) when the rotated token could not be persisted", async () => {
    mockGetConn.mockResolvedValue(conn({ accessTokenExpiresAt: STALE }));
    mockRefresh.mockResolvedValue(FRESH_TOKENS);
    mockUpdate.mockResolvedValue({ outcome: "error" });
    // Must NOT return AT2 — the rotated refresh token was not durably stored, so
    // using its access token would break the next refresh.
    expect(await getValidAccessToken("f1")).toBeNull();
  });

  it("returns null when the refresh token is dead (invalid_grant)", async () => {
    mockGetConn.mockResolvedValue(conn({ accessTokenExpiresAt: STALE }));
    mockRefresh.mockRejectedValue(new QuickbooksError("invalid_grant", "dead"));
    expect(await getValidAccessToken("f1")).toBeNull();
  });
});
