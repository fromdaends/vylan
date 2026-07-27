// Dropbox OAuth client for the filing connector.
//
// The app is created with APP-FOLDER access — Dropbox's analog of Google's
// drive.file scope: Vylan can only see and write inside its own
// /Apps/<app name> folder, never the rest of the firm's Dropbox. Every path
// in API calls is RELATIVE to that folder, so the connection's "root" is
// simply "" and no root-folder bootstrapping is needed.
//
// token_access_type=offline yields a long-lived refresh token (Dropbox does
// not rotate refresh tokens; the short-lived access token renews off it).
// Server-only: the app secret and every token stay here.

const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

export function isDropboxFilingConfigured(): boolean {
  return Boolean(
    process.env.DROPBOX_FILING_APP_KEY?.trim() &&
      process.env.DROPBOX_FILING_APP_SECRET?.trim(),
  );
}

function appKey(): string {
  return process.env.DROPBOX_FILING_APP_KEY?.trim() ?? "";
}
function appSecret(): string {
  return process.env.DROPBOX_FILING_APP_SECRET?.trim() ?? "";
}

export function dropboxRedirectUri(): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}/api/integrations/filing/dropbox/callback`;
}

export function buildDropboxAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: appKey(),
    redirect_uri: dropboxRedirectUri(),
    response_type: "code",
    token_access_type: "offline",
    state,
    // Always show the account chooser — the owner may have personal + work.
    force_reauthentication: "false",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export class DropboxOauthError extends Error {
  constructor(
    message: string,
    /** True when only a reconnect can fix it (grant revoked/expired). */
    public readonly dead = false,
  ) {
    super(message);
    this.name = "DropboxOauthError";
  }
}

export type DropboxTokens = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string; // ISO
};

function expiryIso(expiresInSeconds: unknown): string {
  const secs =
    typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)
      ? expiresInSeconds
      : 14400;
  return new Date(Date.now() + Math.max(60, secs - 60) * 1000).toISOString();
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
    throw new DropboxOauthError(
      `dropbox token endpoint: ${code}`,
      code === "invalid_grant",
    );
  }
  return json;
}

export async function exchangeDropboxCode(code: string): Promise<DropboxTokens> {
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: appKey(),
    client_secret: appSecret(),
    redirect_uri: dropboxRedirectUri(),
  });
  if (typeof json.access_token !== "string") {
    throw new DropboxOauthError("dropbox token endpoint: no access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    accessTokenExpiresAt: expiryIso(json.expires_in),
  };
}

export async function refreshDropboxTokens(
  refreshToken: string,
): Promise<DropboxTokens> {
  const json = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: appKey(),
    client_secret: appSecret(),
  });
  if (typeof json.access_token !== "string") {
    throw new DropboxOauthError("dropbox refresh: no access_token");
  }
  return {
    accessToken: json.access_token,
    // Dropbox keeps the refresh token stable; echo one back only if present.
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    accessTokenExpiresAt: expiryIso(json.expires_in),
  };
}

/** Display label for the connected card: the account's email. Best-effort. */
export async function fetchDropboxAccountEmail(
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      "https://api.dropboxapi.com/2/users/get_current_account",
      { method: "POST", headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: unknown };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

/** Best-effort revocation on disconnect (kills the whole grant). */
export async function revokeDropboxToken(accessToken: string): Promise<void> {
  try {
    await fetch("https://api.dropboxapi.com/2/auth/token/revoke", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    console.error("[filing] dropbox revoke failed:", (e as Error).message);
  }
}

export function isDropboxAccessTokenStale(
  expiresAtIso: string | null,
  nowMs: number,
): boolean {
  if (!expiresAtIso) return true;
  const t = Date.parse(expiresAtIso);
  return !Number.isFinite(t) || t <= nowMs;
}
