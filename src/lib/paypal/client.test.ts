import { beforeEach, describe, expect, it, vi } from "vitest";

// Env-driven config: set the vars before importing, reset the token cache
// between tests.
process.env.PAYPAL_CLIENT_ID = "client-1";
process.env.PAYPAL_CLIENT_SECRET = "secret-1";
process.env.PAYPAL_ENVIRONMENT = "sandbox";
process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = "";

import {
  buildAuthAssertion,
  getPayPalAccessToken,
  paypalFetch,
  _resetPayPalTokenCacheForTests,
} from "./client";

function b64urlDecode(part: string): string {
  const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
  return Buffer.from(
    part.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  ).toString("utf8");
}

beforeEach(() => {
  _resetPayPalTokenCacheForTests();
  vi.restoreAllMocks();
  process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = "";
});

describe("buildAuthAssertion", () => {
  it("is an unsigned two-part JWT naming us and the seller", () => {
    const jwt = buildAuthAssertion("client-1", "SELLER123");
    const [header, payload, sig] = jwt.split(".");
    expect(sig).toBe(""); // trailing dot, empty signature
    expect(JSON.parse(b64urlDecode(header))).toEqual({ alg: "none" });
    expect(JSON.parse(b64urlDecode(payload))).toEqual({
      iss: "client-1",
      payer_id: "SELLER123",
    });
    // base64url alphabet only — no +, /, or padding.
    expect(jwt).not.toMatch(/[+/=]/);
  });
});

describe("getPayPalAccessToken", () => {
  it("fetches once and serves the cached token until expiry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok-1", expires_in: 3600 }),
    } as Response);

    expect(await getPayPalAccessToken()).toBe("tok-1");
    expect(await getPayPalAccessToken()).toBe("tok-1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /,
    );
  });

  it("returns null (never throws) when PayPal rejects the credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid_client" }),
    } as Response);
    expect(await getPayPalAccessToken()).toBeNull();
  });
});

describe("paypalFetch", () => {
  it("adds the auth assertion for on-behalf-of calls and the BN code when set", async () => {
    process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = "VYLAN_BN";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok-1", expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ fine: true }),
      } as Response);

    const res = await paypalFetch("/v2/x", {
      method: "POST",
      body: { a: 1 },
      sellerMerchantId: "SELLER123",
      requestId: "req-1",
    });
    expect(res).toEqual({ status: 200, json: { fine: true } });
    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/x");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-1");
    expect(headers["PayPal-Partner-Attribution-Id"]).toBe("VYLAN_BN");
    expect(headers["PayPal-Auth-Assertion"]).toBe(
      buildAuthAssertion("client-1", "SELLER123"),
    );
    expect(headers["PayPal-Request-Id"]).toBe("req-1");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("omits the partner headers when not applicable", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok-1", expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

    await paypalFetch("/v1/y");
    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["PayPal-Partner-Attribution-Id"]).toBeUndefined();
    expect(headers["PayPal-Auth-Assertion"]).toBeUndefined();
  });
});
