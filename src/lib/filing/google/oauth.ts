// Google OAuth client for the Drive filing connector.
//
// Scope story (the Phase 0 decision): drive.file ONLY — a NON-SENSITIVE scope,
// so no Google restricted-scope verification and no CASA assessment, ever.
// Vylan can only see folders/files it creates itself; the connect flow creates
// one "Vylan" root folder and everything files beneath it. openid+email ride
// along purely to label the connected card ("firm@gmail.com").
//
// Server-only: the client secret and every token stay here. Nothing in this
// module is imported by client components.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const GOOGLE_FILING_SCOPES =
  "https://www.googleapis.com/auth/drive.file openid email";

export function isGoogleFilingConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_FILING_CLIENT_ID?.trim() &&
      process.env.GOOGLE_FILING_CLIENT_SECRET?.trim(),
  );
}

function clientId(): string {
  return process.env.GOOGLE_FILING_CLIENT_ID?.trim() ?? "";
}
function clientSecret(): string {
  return process.env.GOOGLE_FILING_CLIENT_SECRET?.trim() ?? "";
}

// The one redirect URI, derived from APP_URL so dev / preview / prod each use
// their own origin (each must be registered in the Google Cloud console).
export function googleRedirectUri(): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}/api/integrations/filing/google/callback`;
}

export function buildGoogleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_FILING_SCOPES,
    state,
    // offline + consent => Google issues a refresh token on EVERY connect
    // (without prompt=consent, re-connects silently omit it and the
    // connection would die within the hour).
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export class GoogleOauthError extends Error {
  constructor(
    message: string,
    /** True when only a reconnect can fix it (invalid_grant: token revoked/expired). */
    public readonly dead = false,
  ) {
    super(message);
    this.name = "GoogleOauthError";
  }
}

export type GoogleTokens = {
  accessToken: string;
  /** Absent on refresh responses (Google keeps the existing refresh token). */
  refreshToken: string | null;
  accessTokenExpiresAt: string; // ISO
  /** From the id_token when present — labels the connected card. */
  accountEmail: string | null;
};

function expiryIso(expiresInSeconds: unknown): string {
  const secs =
    typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)
      ? expiresInSeconds
      : 3600;
  // Refresh 60s early so a token never expires mid-upload.
  return new Date(Date.now() + Math.max(60, secs - 60) * 1000).toISOString();
}

// Best-effort email out of the id_token (a JWT; payload is base64url JSON).
// Display-only — never used for authorization decisions.
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    // invalid_grant = the refresh token/code is dead (revoked, expired,
    // consent screen still in Testing mode) — only a reconnect fixes it.
    throw new GoogleOauthError(
      `google token endpoint: ${code}`,
      code === "invalid_grant",
    );
  }
  return json;
}

/** Exchange the callback `code` for tokens. */
export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: googleRedirectUri(),
  });
  if (typeof json.access_token !== "string") {
    throw new GoogleOauthError("google token endpoint: no access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    accessTokenExpiresAt: expiryIso(json.expires_in),
    accountEmail: emailFromIdToken(json.id_token),
  };
}

/** Refresh an access token. Google usually keeps the refresh token stable. */
export async function refreshGoogleTokens(
  refreshToken: string,
): Promise<GoogleTokens> {
  const json = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  if (typeof json.access_token !== "string") {
    throw new GoogleOauthError("google refresh: no access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    accessTokenExpiresAt: expiryIso(json.expires_in),
    accountEmail: emailFromIdToken(json.id_token),
  };
}

/**
 * Best-effort token revocation on disconnect (either token works; revoking
 * the refresh token kills the whole grant). Failures are logged, never thrown
 * — the row is disconnected regardless.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  } catch (e) {
    console.error("[filing] google revoke failed:", (e as Error).message);
  }
}

/** Is an access token stale (or about to be)? Mirrors QBO's helper. */
export function isGoogleAccessTokenStale(
  expiresAtIso: string | null,
  nowMs: number,
): boolean {
  if (!expiresAtIso) return true;
  const t = Date.parse(expiresAtIso);
  return !Number.isFinite(t) || t <= nowMs;
}
