import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getOAuthEndpoints,
  FALLBACK_ENDPOINTS,
  __clearDiscoveryCacheForTests,
} from "./discovery";

function mockResponse(opts: { ok: boolean; status?: number; json?: unknown }) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: async () => opts.json,
  } as unknown as Response;
}

// The cache is module-level, so clear it around every test to keep them isolated.
beforeEach(() => __clearDiscoveryCacheForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  __clearDiscoveryCacheForTests();
});

describe("getOAuthEndpoints", () => {
  it("uses the authorize/token/revoke endpoints from the discovery document", async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse({
        ok: true,
        json: {
          authorization_endpoint: "https://disco.example/authorize",
          token_endpoint: "https://disco.example/token",
          revocation_endpoint: "https://disco.example/revoke",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await getOAuthEndpoints("production")).toEqual({
      authorize: "https://disco.example/authorize",
      token: "https://disco.example/token",
      revoke: "https://disco.example/revoke",
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain(".well-known/openid_configuration");
  });

  it("fetches the dedicated sandbox document for the sandbox environment", async () => {
    const fetchMock = vi.fn(async () => mockResponse({ ok: true, json: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await getOAuthEndpoints("sandbox");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("openid_sandbox_configuration");
  });

  it("falls back to the well-known endpoints when discovery is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await getOAuthEndpoints("production")).toEqual(FALLBACK_ENDPOINTS);
  });

  it("falls back on a non-2xx discovery response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse({ ok: false, status: 503 })),
    );
    expect(await getOAuthEndpoints("production")).toEqual(FALLBACK_ENDPOINTS);
  });

  it("fills any missing field from the fallback (partial document)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({
          ok: true,
          json: { token_endpoint: "https://disco.example/token" },
        }),
      ),
    );
    const ep = await getOAuthEndpoints("production");
    expect(ep.token).toBe("https://disco.example/token");
    expect(ep.authorize).toBe(FALLBACK_ENDPOINTS.authorize);
    expect(ep.revoke).toBe(FALLBACK_ENDPOINTS.revoke);
  });

  it("caches the result — fetches the document only once across calls", async () => {
    const fetchMock = vi.fn(async () => mockResponse({ ok: true, json: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await getOAuthEndpoints("production");
    await getOAuthEndpoints("production");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
