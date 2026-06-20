// QuickBooks (Intuit) OAuth 2.0 client — Stage 1, CONNECTION ONLY.
//
// A thin wrapper over Intuit's OAuth 2.0 + the single CompanyInfo identity read
// used to show the connected company's name. Credentials are read from the
// environment on every call (never hardcoded, never logged). Sandbox vs
// production is a runtime switch (QBO_ENVIRONMENT) so going live is one env-var
// change with no code change.
//
// Endpoints (per https://developer.intuit.com — OAuth 2.0):
//   authorize : https://appcenter.intuit.com/connect/oauth2
//   token     : https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
//   revoke    : https://developer.api.intuit.com/v2/oauth2/tokens/revoke   (Phase 2)
//   API base  : sandbox    https://sandbox-quickbooks.api.intuit.com
//               production https://quickbooks.api.intuit.com
//
// The OAuth authorize/token endpoints are the SAME for sandbox and production —
// the environment only selects which app keys you use and which API base URL the
// data calls hit. Stage 1 makes exactly one data call: an identity-only
// CompanyInfo read to display the company name. No financial data, no
// transactions, no documents.

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
// Bound every Intuit network call so a slow/hung endpoint can never block a
// server render (the Settings keep-alive awaits refreshTokens) or a route. 10s is
// well under the platform request timeout. Same approach as src/app/api/files.
const QBO_FETCH_TIMEOUT_MS = 10_000;
// QuickBooks Online Accounting scope — what later stages will need to read/write
// the books. Requesting it now means the accountant approves once.
const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

export type QuickbooksEnvironment = "sandbox" | "production";

export class QuickbooksError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "token_exchange_failed"
      | "token_refresh_failed"
      | "invalid_grant"
      | "company_info_failed"
      | "request_failed",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "QuickbooksError";
  }
}

// Both the client id and secret must be present for the connection to work. When
// either is missing the Settings card shows a calm "not set up yet" note instead
// of erroring (same graceful behavior as Stripe / SignWell).
export function isQuickbooksConfigured(): boolean {
  return Boolean(
    process.env.QBO_CLIENT_ID?.trim() && process.env.QBO_CLIENT_SECRET?.trim(),
  );
}

// The environment switch. Defaults to sandbox and only flips to production when
// QBO_ENVIRONMENT is exactly "production" (case-insensitive) — fails safe to
// sandbox so we can never accidentally hit a real QuickBooks company.
export function quickbooksEnvironment(): QuickbooksEnvironment {
  return (process.env.QBO_ENVIRONMENT ?? "").trim().toLowerCase() ===
    "production"
    ? "production"
    : "sandbox";
}

// The exact redirect URI Intuit sends the accountant back to. Intuit requires it
// to match a URI registered in the app settings EXACTLY, so it is an explicit env
// var; it falls back to APP_URL so local dev works without extra config.
export function quickbooksRedirectUri(): string {
  const explicit = process.env.QBO_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api/integrations/quickbooks/callback`;
}

// Data-API base URL for the current environment (used by the CompanyInfo read).
export function quickbooksApiBaseUrl(): string {
  return quickbooksEnvironment() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

// Build the Intuit authorization URL the browser is sent to. `state` is an
// opaque anti-forgery value we verify on the callback.
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID?.trim() ?? "",
    response_type: "code",
    scope: ACCOUNTING_SCOPE,
    redirect_uri: quickbooksRedirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type QuickbooksTokens = {
  accessToken: string;
  refreshToken: string;
  // Absolute expiry instants (ISO strings) so they can be compared later without
  // re-deriving from a relative "expires_in".
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string | null;
};

type IntuitTokenResponse = {
  token_type?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // access-token lifetime, seconds (~3600)
  x_refresh_token_expires_in?: number; // refresh-token lifetime, seconds (~100d)
};

// Pure mapper from Intuit's token JSON to our absolute-expiry shape. Separated so
// the expiry math is unit-testable without a network call. `nowMs` is injected.
export function tokensFromResponse(
  json: IntuitTokenResponse,
  nowMs: number,
): QuickbooksTokens {
  if (!json.access_token || !json.refresh_token) {
    throw new QuickbooksError(
      "token_exchange_failed",
      "Intuit token response missing access_token or refresh_token",
    );
  }
  const accessSecs = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const refreshSecs =
    typeof json.x_refresh_token_expires_in === "number"
      ? json.x_refresh_token_expires_in
      : null;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresAt: new Date(nowMs + accessSecs * 1000).toISOString(),
    refreshTokenExpiresAt:
      refreshSecs != null
        ? new Date(nowMs + refreshSecs * 1000).toISOString()
        : null,
  };
}

function basicAuthHeader(): string {
  const id = process.env.QBO_CLIENT_ID?.trim() ?? "";
  const secret = process.env.QBO_CLIENT_SECRET?.trim() ?? "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

// Exchange the one-time authorization code for tokens (the callback step).
export async function exchangeCodeForTokens(
  code: string,
): Promise<QuickbooksTokens> {
  if (!isQuickbooksConfigured()) {
    throw new QuickbooksError("not_configured", "QuickBooks is not configured");
  }
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: quickbooksRedirectUri(),
      }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new QuickbooksError(
      "request_failed",
      `QuickBooks token request failed: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new QuickbooksError(
      "token_exchange_failed",
      `QuickBooks token exchange failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as IntuitTokenResponse;
  return tokensFromResponse(json, Date.now());
}

// Exchange a refresh token for a fresh set of tokens. Intuit ROTATES the refresh
// token periodically, so the caller MUST persist whatever comes back (both the
// new access token and the possibly-new refresh token). Throws with code
// "invalid_grant" when the refresh token is expired/revoked (the connection is
// dead and must be re-established), vs "token_refresh_failed" for other errors.
export async function refreshTokens(
  refreshToken: string,
): Promise<QuickbooksTokens> {
  if (!isQuickbooksConfigured()) {
    throw new QuickbooksError("not_configured", "QuickBooks is not configured");
  }
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new QuickbooksError(
      "request_failed",
      `QuickBooks token refresh request failed: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const dead = /invalid_grant/i.test(detail);
    throw new QuickbooksError(
      dead ? "invalid_grant" : "token_refresh_failed",
      `QuickBooks token refresh failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as IntuitTokenResponse;
  return tokensFromResponse(json, Date.now());
}

// Tell Intuit to revoke our access for this connection (the accountant
// disconnected). Revoking the refresh token revokes the whole grant. Best-effort:
// returns true on success, false on any failure, and never throws — disconnect
// must still clear our local record even if Intuit can't be reached.
export async function revokeToken(token: string): Promise<boolean> {
  if (!isQuickbooksConfigured()) return false;
  try {
    const res = await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Is the access token expired, or close enough that we should refresh now? A
// missing/unparseable expiry is treated as stale (refresh to be safe). The buffer
// avoids racing an about-to-expire token.
export function isAccessTokenStale(
  expiresAt: string | null,
  nowMs: number,
  bufferMs = 5 * 60 * 1000,
): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t - nowMs <= bufferMs;
}

// ONE identity-only read: the connected company's display name, so the connected
// card can show it. This is NOT financial data and touches no transactions or
// documents. Returns null on any failure (the connection is still valid; we just
// fall back to showing the company id).
export async function fetchCompanyName(
  accessToken: string,
  realmId: string,
): Promise<string | null> {
  const url =
    `${quickbooksApiBaseUrl()}/v3/company/${encodeURIComponent(realmId)}` +
    `/companyinfo/${encodeURIComponent(realmId)}?minorversion=65`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const json = (await res.json()) as {
      CompanyInfo?: { CompanyName?: string };
    };
    const name = json.CompanyInfo?.CompanyName?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

// Cap any upstream error body we keep so a large/HTML error page can't bloat a
// log line. Tokens/keys never appear in these bodies.
function truncate(s: string, max = 500): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}
