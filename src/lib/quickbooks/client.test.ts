import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isQuickbooksConfigured,
  quickbooksEnvironment,
  quickbooksRedirectUri,
  quickbooksApiBaseUrl,
  buildAuthorizeUrl,
  tokensFromResponse,
  QuickbooksError,
} from "./client";

// Snapshot + restore the env vars these helpers read, so tests don't leak.
const ENV_KEYS = [
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_ENVIRONMENT",
  "QBO_REDIRECT_URI",
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

describe("quickbooksApiBaseUrl", () => {
  it("picks the sandbox vs production host from the environment switch", () => {
    expect(quickbooksApiBaseUrl()).toContain("sandbox-quickbooks.api.intuit.com");
    process.env.QBO_ENVIRONMENT = "production";
    expect(quickbooksApiBaseUrl()).toBe("https://quickbooks.api.intuit.com");
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
  it("includes the accounting scope, state, redirect, and client id", () => {
    process.env.QBO_CLIENT_ID = "client-123";
    process.env.QBO_REDIRECT_URI = "https://app.example.com/cb";
    const url = new URL(buildAuthorizeUrl("state-xyz"));
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
