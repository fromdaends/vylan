import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isQuickbooksConfigured,
  quickbooksEnvironment,
  quickbooksRedirectUri,
  quickbooksApiBaseUrl,
  buildAuthorizeUrl,
  tokensFromResponse,
  refreshTokens,
  revokeToken,
  isAccessTokenStale,
  quickbooksQuery,
  quickbooksCreate,
  quickbooksProductionKeyMissing,
  QuickbooksError,
} from "./client";

// Isolate OAuth-endpoint resolution: the discovery document is exercised on its
// own in discovery.test.ts. Here it always yields the well-known endpoints
// (no network), so the fetch mock only ever sees the token / revoke POSTs.
vi.mock("./discovery", () => ({
  getOAuthEndpoints: vi.fn(async () => ({
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  })),
}));

// Snapshot + restore the env vars these helpers read, so tests don't leak.
const ENV_KEYS = [
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_ENVIRONMENT",
  "QBO_REDIRECT_URI",
  "QBO_TOKEN_ENC_KEY",
  "APP_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isQuickbooksConfigured", () => {
  it("is false unless BOTH client id and secret are set", () => {
    expect(isQuickbooksConfigured()).toBe(false);
    process.env.QBO_CLIENT_ID = "abc";
    expect(isQuickbooksConfigured()).toBe(false);
    process.env.QBO_CLIENT_SECRET = "secret";
    expect(isQuickbooksConfigured()).toBe(true);
  });
});

describe("quickbooksEnvironment", () => {
  it("defaults to sandbox and fails safe to sandbox", () => {
    expect(quickbooksEnvironment()).toBe("sandbox");
    process.env.QBO_ENVIRONMENT = "";
    expect(quickbooksEnvironment()).toBe("sandbox");
    process.env.QBO_ENVIRONMENT = "Sandbox";
    expect(quickbooksEnvironment()).toBe("sandbox");
    process.env.QBO_ENVIRONMENT = "prod";
    expect(quickbooksEnvironment()).toBe("sandbox");
  });
  it("is production only when exactly 'production' (case-insensitive)", () => {
    process.env.QBO_ENVIRONMENT = "production";
    expect(quickbooksEnvironment()).toBe("production");
    process.env.QBO_ENVIRONMENT = "PRODUCTION";
    expect(quickbooksEnvironment()).toBe("production");
  });
});

describe("quickbooksProductionKeyMissing", () => {
  // A valid 32-byte key (base64). The guard only cares that it parses.
  const VALID_KEY = Buffer.alloc(32, 7).toString("base64");

  it("never blocks sandbox (key or no key)", () => {
    expect(quickbooksProductionKeyMissing()).toBe(false);
    process.env.QBO_ENVIRONMENT = "sandbox";
    expect(quickbooksProductionKeyMissing()).toBe(false);
  });

  it("blocks production without an encryption key", () => {
    process.env.QBO_ENVIRONMENT = "production";
    expect(quickbooksProductionKeyMissing()).toBe(true);
  });

  it("blocks production with a malformed key (not 32 bytes)", () => {
    // Silence the expected "not a 32-byte key" complaint from the key parser.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.QBO_ENVIRONMENT = "production";
    process.env.QBO_TOKEN_ENC_KEY = "too-short";
    expect(quickbooksProductionKeyMissing()).toBe(true);
    spy.mockRestore();
  });

  it("allows production once a valid key is set", () => {
    process.env.QBO_ENVIRONMENT = "production";
    process.env.QBO_TOKEN_ENC_KEY = VALID_KEY;
    expect(quickbooksProductionKeyMissing()).toBe(false);
  });
});

describe("quickbooksApiBaseUrl", () => {
  it("picks the sandbox vs production host from the environment switch", () => {
    expect(quickbooksApiBaseUrl()).toContain("sandbox-quickbooks.api.intuit.com");
    process.env.QBO_ENVIRONMENT = "production";
    expect(quickbooksApiBaseUrl()).toBe("https://quickbooks.api.intuit.com");
  });
  it("prefers the per-connection environment over the global switch", () => {
    process.env.QBO_ENVIRONMENT = "production"; // global says prod
    expect(quickbooksApiBaseUrl("sandbox")).toContain(
      "sandbox-quickbooks.api.intuit.com",
    );
    expect(quickbooksApiBaseUrl("production")).toBe(
      "https://quickbooks.api.intuit.com",
    );
  });
});

describe("quickbooksRedirectUri", () => {
  it("uses the explicit env var when set", () => {
    process.env.QBO_REDIRECT_URI = "https://app.example.com/cb";
    expect(quickbooksRedirectUri()).toBe("https://app.example.com/cb");
  });
  it("falls back to APP_URL + the callback path", () => {
    process.env.APP_URL = "https://vylan.app/";
    expect(quickbooksRedirectUri()).toBe(
      "https://vylan.app/api/integrations/quickbooks/callback",
    );
  });
  it("defaults to localhost when nothing is set", () => {
    expect(quickbooksRedirectUri()).toBe(
      "http://localhost:3000/api/integrations/quickbooks/callback",
    );
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes the accounting scope, state, redirect, and client id", async () => {
    process.env.QBO_CLIENT_ID = "client-123";
    process.env.QBO_REDIRECT_URI = "https://app.example.com/cb";
    const url = new URL(await buildAuthorizeUrl("state-xyz"));
    expect(url.origin + url.pathname).toBe(
      "https://appcenter.intuit.com/connect/oauth2",
    );
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/cb",
    );
    expect(url.searchParams.get("state")).toBe("state-xyz");
  });
});

describe("tokensFromResponse", () => {
  const now = 1_700_000_000_000; // fixed instant

  it("maps tokens and computes absolute expiries from the lifetimes", () => {
    const t = tokensFromResponse(
      {
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        x_refresh_token_expires_in: 8_726_400,
      },
      now,
    );
    expect(t.accessToken).toBe("at");
    expect(t.refreshToken).toBe("rt");
    expect(t.accessTokenExpiresAt).toBe(new Date(now + 3600_000).toISOString());
    expect(t.refreshTokenExpiresAt).toBe(
      new Date(now + 8_726_400_000).toISOString(),
    );
  });

  it("defaults the access lifetime and allows a null refresh expiry", () => {
    const t = tokensFromResponse({ access_token: "at", refresh_token: "rt" }, now);
    expect(t.accessTokenExpiresAt).toBe(new Date(now + 3600_000).toISOString());
    expect(t.refreshTokenExpiresAt).toBeNull();
  });

  it("throws when the response is missing tokens", () => {
    expect(() => tokensFromResponse({ access_token: "at" }, now)).toThrow(
      QuickbooksError,
    );
    expect(() => tokensFromResponse({}, now)).toThrow(/missing/i);
  });
});

describe("isAccessTokenStale", () => {
  const now = 1_700_000_000_000;
  it("treats a missing or unparseable expiry as stale", () => {
    expect(isAccessTokenStale(null, now)).toBe(true);
    expect(isAccessTokenStale("not-a-date", now)).toBe(true);
  });
  it("is stale when expired or within the safety buffer", () => {
    expect(isAccessTokenStale(new Date(now - 1000).toISOString(), now)).toBe(true);
    // 2 minutes left, default buffer is 5 minutes -> stale.
    expect(
      isAccessTokenStale(new Date(now + 2 * 60_000).toISOString(), now),
    ).toBe(true);
  });
  it("is fresh when comfortably in the future", () => {
    expect(
      isAccessTokenStale(new Date(now + 30 * 60_000).toISOString(), now),
    ).toBe(false);
  });
});

// Build a minimal fetch Response stand-in for the network helpers.
function mockResponse(opts: {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  tid?: string; // value returned for the intuit_tid response header
}) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 400),
    json: async () => opts.json,
    text: async () => opts.text ?? "",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "intuit_tid" ? (opts.tid ?? null) : null,
    },
  } as unknown as Response;
}

describe("refreshTokens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts grant_type=refresh_token with Basic auth and maps the response", async () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    const fetchMock = vi.fn(async () =>
      mockResponse({
        ok: true,
        json: {
          access_token: "new-at",
          refresh_token: "new-rt",
          expires_in: 3600,
          x_refresh_token_expires_in: 8_726_400,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await refreshTokens("old-rt");
    expect(tokens.accessToken).toBe("new-at");
    expect(tokens.refreshToken).toBe("new-rt");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("oauth2/v1/tokens/bearer");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=old-rt");
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(
      `Basic ${Buffer.from("cid:csecret").toString("base64")}`,
    );
  });

  it("throws invalid_grant when the refresh token is dead", async () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({ ok: false, status: 400, text: '{"error":"invalid_grant"}' }),
      ),
    );
    await expect(refreshTokens("dead")).rejects.toMatchObject({
      code: "invalid_grant",
    });
  });

  it("retries a persistent 5xx then throws token_refresh_failed", async () => {
    vi.useFakeTimers();
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    const fetchMock = vi.fn(async () =>
      mockResponse({ ok: false, status: 500, text: "server error" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const promise = refreshTokens("rt");
    // Attach the rejection handler BEFORE draining the backoff timers so the
    // eventual rejection is never flagged as unhandled.
    const assertion = expect(promise).rejects.toMatchObject({
      code: "token_refresh_failed",
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // exhausts all attempts
  });

  it("throws not_configured without app keys", async () => {
    await expect(refreshTokens("rt")).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});

// The transient-retry behavior is shared by every token-endpoint call (exchange +
// refresh); we exercise it through refreshTokens.
describe("token endpoint transient retry", () => {
  beforeEach(() => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const okBody = {
    ok: true,
    json: {
      access_token: "new-at",
      refresh_token: "new-rt",
      expires_in: 3600,
    },
  };

  it("retries a 5xx and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 503, text: "unavailable" }),
      )
      .mockResolvedValueOnce(mockResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);
    const promise = refreshTokens("old-rt");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ accessToken: "new-at" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 rate limit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 429, text: "slow down" }),
      )
      .mockResolvedValueOnce(mockResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);
    const promise = refreshTokens("old-rt");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ accessToken: "new-at" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries network errors, then throws request_failed after the last attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const promise = refreshTokens("old-rt");
    const assertion = expect(promise).rejects.toMatchObject({
      code: "request_failed",
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a permanent invalid_grant (fails fast)", async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse({ ok: false, status: 400, text: '{"error":"invalid_grant"}' }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(refreshTokens("dead")).rejects.toMatchObject({
      code: "invalid_grant",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("revokeToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns true on a successful revoke and posts to the revoke endpoint", async () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    const fetchMock = vi.fn(async () => mockResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(revokeToken("rt")).resolves.toBe(true);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("oauth2/tokens/revoke");
  });

  it("returns false when Intuit rejects or errors (best-effort)", async () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(revokeToken("rt")).resolves.toBe(false);
  });

  it("returns false (no call) when not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(revokeToken("rt")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("quickbooksQuery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the /query URL (encoded query, minorversion 75, per-env host) and returns QueryResponse", async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse({ ok: true, json: { QueryResponse: { Account: [{ Id: "1" }] } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const qr = await quickbooksQuery(
      "AT",
      "realm1",
      "SELECT * FROM Account",
      "sandbox",
    );
    expect(qr.Account).toEqual([{ Id: "1" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("sandbox-quickbooks.api.intuit.com");
    expect(url).toContain("/v3/company/realm1/query");
    expect(url).toContain("query=SELECT%20*%20FROM%20Account");
    expect(url).toContain("minorversion=75");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer AT",
    );
  });

  it("throws read_failed on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse({ ok: false, status: 401, text: "unauthorized" })),
    );
    await expect(
      quickbooksQuery("AT", "r", "SELECT * FROM Account", "sandbox"),
    ).rejects.toMatchObject({ code: "read_failed" });
  });

  it("throws request_failed on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    await expect(
      quickbooksQuery("AT", "r", "Q", "sandbox"),
    ).rejects.toMatchObject({ code: "request_failed" });
  });

  it("returns {} when the response has no QueryResponse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({ ok: true, json: {} })));
    expect(await quickbooksQuery("AT", "r", "Q", "sandbox")).toEqual({});
  });
});

describe("intuit_tid capture on failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captures the intuit_tid header on a read failure (on the error + in the message)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({ ok: false, status: 400, text: "bad query", tid: "TID-READ-1" }),
      ),
    );
    const err = (await quickbooksQuery("AT", "r", "Q", "sandbox").catch(
      (e) => e,
    )) as QuickbooksError;
    expect(err).toBeInstanceOf(QuickbooksError);
    expect(err.code).toBe("read_failed");
    expect(err.tid).toBe("TID-READ-1");
    expect(err.message).toContain("intuit_tid: TID-READ-1");
  });

  it("captures the intuit_tid header on a token refresh failure", async () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({
          ok: false,
          status: 400,
          text: '{"error":"invalid_grant"}',
          tid: "TID-TOK-9",
        }),
      ),
    );
    const err = (await refreshTokens("dead").catch(
      (e) => e,
    )) as QuickbooksError;
    expect(err.code).toBe("invalid_grant");
    expect(err.tid).toBe("TID-TOK-9");
    expect(err.message).toContain("intuit_tid: TID-TOK-9");
  });

  it("leaves tid undefined and adds no suffix when the header is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse({ ok: false, status: 500, text: "err" })),
    );
    const err = (await quickbooksQuery("AT", "r", "Q", "sandbox").catch(
      (e) => e,
    )) as QuickbooksError;
    expect(err.tid).toBeUndefined();
    expect(err.message).not.toContain("intuit_tid");
  });

  it("keeps the tid at the front so it survives the 500-char post_error cap (write path)", async () => {
    // Regression guard: a long Intuit fault body used to push a TRAILING tid past
    // 500 chars, where recordDraftPostError's slice(0, 500) dropped it — exactly on
    // the failed-post path that most needs it. Prepending keeps it.
    const longBody = "x".repeat(2000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({ ok: false, status: 400, text: longBody, tid: "TID-POST-7" }),
      ),
    );
    const err = (await quickbooksCreate(
      { accessToken: "AT", realmId: "r", environment: "sandbox" },
      "bill",
      {},
      "req-1",
    ).catch((e) => e)) as QuickbooksError;
    expect(err.code).toBe("write_failed");
    expect(err.tid).toBe("TID-POST-7");
    // The tid must survive a downstream slice(0, 500) — the DB post_error cap.
    expect(err.message.slice(0, 500)).toContain("intuit_tid: TID-POST-7");
  });
});
