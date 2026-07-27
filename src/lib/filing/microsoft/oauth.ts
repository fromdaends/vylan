// Microsoft identity OAuth client for the SharePoint/OneDrive connector.
//
// The /common endpoint accepts both work/school accounts (SharePoint +
// OneDrive for Business) and personal Microsoft accounts (personal OneDrive),
// so a solo accountant on a personal plan connects the same way as a firm on
// Microsoft 365. All scopes are DELEGATED (Vylan acts as the signed-in user,
// bounded by their own permissions): Files.ReadWrite for the user's drive,
// Sites.ReadWrite.All for SharePoint libraries the user can already access.
// Neither requires tenant-admin consent by default, but locked-down tenants
// can force an approval flow — the connect card copy warns about that.
//
// Microsoft ROTATES the refresh token on every refresh (unlike Google): the
// returned refresh_token must always be persisted, which the fingerprint-
// matched update in the data layer handles.
//
// Server-only: the client secret and every token stay here.

const AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";

export const MICROSOFT_FILING_SCOPES =
  "openid email offline_access User.Read Files.ReadWrite Sites.ReadWrite.All";

export function isMicrosoftFilingConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_FILING_CLIENT_ID?.trim() &&
      process.env.MICROSOFT_FILING_CLIENT_SECRET?.trim(),
  );
}

function clientId(): string {
  return process.env.MICROSOFT_FILING_CLIENT_ID?.trim() ?? "";
}
function clientSecret(): string {
  return process.env.MICROSOFT_FILING_CLIENT_SECRET?.trim() ?? "";
}

export function microsoftRedirectUri(): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}/api/integrations/filing/microsoft/callback`;
}

export function buildMicrosoftAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: microsoftRedirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_FILING_SCOPES,
    state,
    // Always show the account chooser: an owner with several Microsoft
    // accounts (personal + firm) must pick the right one consciously.
    prompt: "select_account",
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

export class MicrosoftOauthError extends Error {
  constructor(
    message: string,
    /** True when only a reconnect can fix it (grant revoked/expired). */
    public readonly dead = false,
  ) {
    super(message);
    this.name = "MicrosoftOauthError";
  }
}

export type MicrosoftTokens = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string; // ISO
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

// Display-only email from the id_token (JWT payload, base64url JSON): the
// `email` claim when present, else `preferred_username` (usually the UPN,
// which reads like an email). Never used for authorization decisions.
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { email?: unknown; preferred_username?: unknown };
    if (typeof payload.email === "string") return payload.email;
    if (typeof payload.preferred_username === "string") {
      return payload.preferred_username;
    }
    return null;
  } catch {
    return null;
  }
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    // invalid_grant = code/refresh token dead (revoked, expired, password
    // change in some tenants) — only a reconnect fixes it.
    throw new MicrosoftOauthError(
      `microsoft token endpoint: ${code}`,
      code === "invalid_grant",
    );
  }
  return json;
}

export async function exchangeMicrosoftCode(
  code: string,
): Promise<MicrosoftTokens> {
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: microsoftRedirectUri(),
    scope: MICROSOFT_FILING_SCOPES,
  });
  if (typeof json.access_token !== "string") {
    throw new MicrosoftOauthError("microsoft token endpoint: no access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    accessTokenExpiresAt: expiryIso(json.expires_in),
    accountEmail: emailFromIdToken(json.id_token),
  };
}

export async function refreshMicrosoftTokens(
  refreshToken: string,
): Promise<MicrosoftTokens> {
  const json = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    scope: MICROSOFT_FILING_SCOPES,
  });
  if (typeof json.access_token !== "string") {
    throw new MicrosoftOauthError("microsoft refresh: no access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === "string" ? json.refresh_token : null,
    accessTokenExpiresAt: expiryIso(json.expires_in),
    accountEmail: emailFromIdToken(json.id_token),
  };
}

/** Is an access token stale (or about to be)? */
export function isMicrosoftAccessTokenStale(
  expiresAtIso: string | null,
  nowMs: number,
): boolean {
  if (!expiresAtIso) return true;
  const t = Date.parse(expiresAtIso);
  return !Number.isFinite(t) || t <= nowMs;
}
