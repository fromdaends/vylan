import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MicrosoftOauthError,
  buildMicrosoftAuthorizeUrl,
  exchangeMicrosoftCode,
  isMicrosoftAccessTokenStale,
  isMicrosoftFilingConfigured,
  microsoftRedirectUri,
  refreshMicrosoftTokens,
} from "./oauth";

beforeEach(() => {
  process.env.MICROSOFT_FILING_CLIENT_ID = "cid";
  process.env.MICROSOFT_FILING_CLIENT_SECRET = "sec";
  process.env.APP_URL = "https://vylan.app";
});
afterEach(() => {
  delete process.env.MICROSOFT_FILING_CLIENT_ID;
  delete process.env.MICROSOFT_FILING_CLIENT_SECRET;
  vi.unstubAllGlobals();
});

describe("config + urls", () => {
  it("is configured only with both credentials", () => {
    expect(isMicrosoftFilingConfigured()).toBe(true);
    delete process.env.MICROSOFT_FILING_CLIENT_SECRET;
    expect(isMicrosoftFilingConfigured()).toBe(false);
  });

  it("derives the redirect from APP_URL", () => {
    expect(microsoftRedirectUri()).toBe(
      "https://vylan.app/api/integrations/filing/microsoft/callback",
    );
  });

  it("authorize url uses /common, delegated scopes, offline access, account chooser", () => {
    const url = new URL(buildMicrosoftAuthorizeUrl("state123"));
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("Files.ReadWrite");
    expect(scope).toContain("Sites.ReadWrite.All");
    expect(scope).toContain("offline_access");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("state")).toBe("state123");
  });
});

function idToken(claims: Record<string, string>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `h.${payload}.s`;
}

describe("token exchange", () => {
  it("parses tokens; email falls back to preferred_username", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            id_token: idToken({ preferred_username: "zach@firm.ca" }),
          }),
          { status: 200 },
        ),
      ),
    );
    const tokens = await exchangeMicrosoftCode("code1");
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.accountEmail).toBe("zach@firm.ca");
  });

  it("marks invalid_grant as DEAD (reconnect required)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      ),
    );
    const err = await refreshMicrosoftTokens("dead-rt").catch((e) => e);
    expect(err).toBeInstanceOf(MicrosoftOauthError);
    expect((err as MicrosoftOauthError).dead).toBe(true);
  });

  it("keeps other failures transient (not dead)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 })),
    );
    const err = await refreshMicrosoftTokens("rt").catch((e) => e);
    expect(err).toBeInstanceOf(MicrosoftOauthError);
    expect((err as MicrosoftOauthError).dead).toBe(false);
  });
});

describe("isMicrosoftAccessTokenStale", () => {
  it("stale when missing, past, or unparseable; fresh in the future", () => {
    const now = Date.now();
    expect(isMicrosoftAccessTokenStale(null, now)).toBe(true);
    expect(isMicrosoftAccessTokenStale("garbage", now)).toBe(true);
    expect(
      isMicrosoftAccessTokenStale(new Date(now - 1000).toISOString(), now),
    ).toBe(true);
    expect(
      isMicrosoftAccessTokenStale(new Date(now + 60_000).toISOString(), now),
    ).toBe(false);
  });
});
