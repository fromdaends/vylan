import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleOauthError,
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  googleRedirectUri,
  isGoogleAccessTokenStale,
  isGoogleFilingConfigured,
  refreshGoogleTokens,
} from "./oauth";

beforeEach(() => {
  process.env.GOOGLE_FILING_CLIENT_ID = "cid";
  process.env.GOOGLE_FILING_CLIENT_SECRET = "sec";
  process.env.APP_URL = "https://vylan.app";
});
afterEach(() => {
  delete process.env.GOOGLE_FILING_CLIENT_ID;
  delete process.env.GOOGLE_FILING_CLIENT_SECRET;
  vi.unstubAllGlobals();
});

describe("config + urls", () => {
  it("is configured only with both credentials", () => {
    expect(isGoogleFilingConfigured()).toBe(true);
    delete process.env.GOOGLE_FILING_CLIENT_SECRET;
    expect(isGoogleFilingConfigured()).toBe(false);
  });

  it("derives the redirect from APP_URL", () => {
    expect(googleRedirectUri()).toBe(
      "https://vylan.app/api/integrations/filing/google/callback",
    );
  });

  it("authorize url carries drive.file, offline access, and forced consent", () => {
    const url = new URL(buildGoogleAuthorizeUrl("state123"));
    expect(url.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state123");
    // The narrow-scope guarantee: nothing beyond drive.file + identity.
    expect(url.searchParams.get("scope")).not.toContain("drive.readonly");
    expect(url.searchParams.get("scope")).not.toMatch(/auth\/drive(\s|$)/);
  });
});

function idToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return `h.${payload}.s`;
}

describe("token exchange", () => {
  it("parses tokens and the account email from the id_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            id_token: idToken("firm@gmail.com"),
          }),
          { status: 200 },
        ),
      ),
    );
    const tokens = await exchangeGoogleCode("code1");
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.accountEmail).toBe("firm@gmail.com");
    expect(Date.parse(tokens.accessTokenExpiresAt)).toBeGreaterThan(Date.now());
  });

  it("marks invalid_grant as DEAD (reconnect required)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      ),
    );
    const err = await refreshGoogleTokens("dead-rt").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleOauthError);
    expect((err as GoogleOauthError).dead).toBe(true);
  });

  it("keeps other failures transient (not dead)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 })),
    );
    const err = await refreshGoogleTokens("rt").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleOauthError);
    expect((err as GoogleOauthError).dead).toBe(false);
  });
});

describe("isGoogleAccessTokenStale", () => {
  it("stale when missing, past, or unparseable; fresh when in the future", () => {
    const now = Date.now();
    expect(isGoogleAccessTokenStale(null, now)).toBe(true);
    expect(isGoogleAccessTokenStale("garbage", now)).toBe(true);
    expect(
      isGoogleAccessTokenStale(new Date(now - 1000).toISOString(), now),
    ).toBe(true);
    expect(
      isGoogleAccessTokenStale(new Date(now + 60_000).toISOString(), now),
    ).toBe(false);
  });
});
