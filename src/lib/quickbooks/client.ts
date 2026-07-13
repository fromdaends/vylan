// QuickBooks (Intuit) OAuth 2.0 client — Stage 1, CONNECTION ONLY.
//
// A thin wrapper over Intuit's OAuth 2.0 + the single CompanyInfo identity read
// used to show the connected company's name. Credentials are read from the
// environment on every call (never hardcoded, never logged). Sandbox vs
// production is a runtime switch (QBO_ENVIRONMENT) so going live is one env-var
// change with no code change.
//
// Endpoints (per https://developer.intuit.com — OAuth 2.0) are resolved at
// runtime from Intuit's OpenID discovery document (see ./discovery), which falls
// back to these well-known values if discovery is briefly unreachable:
//   authorize : https://appcenter.intuit.com/connect/oauth2
//   token     : https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
//   revoke    : https://developer.api.intuit.com/v2/oauth2/tokens/revoke
//   API base  : sandbox    https://sandbox-quickbooks.api.intuit.com
//               production https://quickbooks.api.intuit.com
//
// The OAuth authorize/token endpoints are the SAME for sandbox and production —
// the environment only selects which app keys you use and which API base URL the
// data calls hit. Stage 1 makes exactly one data call: an identity-only
// CompanyInfo read to display the company name. No financial data, no
// transactions, no documents.

import { getOAuthEndpoints } from "./discovery";
import { isTokenEncryptionConfigured } from "./token-cipher";

// Bound every Intuit network call so a slow/hung endpoint can never block a
// server render (the Settings keep-alive awaits refreshTokens) or a route. 10s is
// well under the platform request timeout. Same approach as src/app/api/files.
const QBO_FETCH_TIMEOUT_MS = 10_000;
// Automatic retry for TRANSIENT token-endpoint failures (network error, timeout,
// HTTP 429, or 5xx). We retry these with a short exponential backoff so a passing
// blip on Intuit's side self-heals instead of breaking a refresh. Permanent auth
// failures (invalid_grant, other 4xx) are NEVER retried — retrying only hammers
// the endpoint and can't succeed.
const TOKEN_RETRY_MAX_ATTEMPTS = 3;
const TOKEN_RETRY_BASE_MS = 300;
// QuickBooks Online Accounting scope — what later stages will need to read/write
// the books. Requesting it now means the accountant approves once.
const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";
// QuickBooks pins its data schema by "minorversion". Intuit retired versions <= 74
// (Aug 2025), so every call standardizes on this single constant.
export const QBO_MINORVERSION = "75";

export type QuickbooksEnvironment = "sandbox" | "production";

export class QuickbooksError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "token_exchange_failed"
      | "token_refresh_failed"
      | "invalid_grant"
      | "company_info_failed"
      | "read_failed"
      | "request_failed"
      | "write_failed",
    message: string,
    public readonly status?: number,
    // Intuit's per-response trace id (the `intuit_tid` response header). Captured
    // on failures and appended to `message` so it lands in our logs; quoting it in
    // an Intuit support ticket lets their team pinpoint the exact failed request.
    public readonly tid?: string,
  ) {
    super(message);
    this.name = "QuickbooksError";
  }
}

// Read Intuit's `intuit_tid` trace id off a response (header names are
// case-insensitive). Defensive `?.` so a partial mock in tests can't throw — a
// real fetch Response always has a Headers object.
function tidOf(res: Response): string | undefined {
  const tid = res.headers?.get?.("intuit_tid");
  return tid && tid.trim() ? tid.trim() : undefined;
}

// PREPEND the trace id to an error message, e.g. "[intuit_tid: abc] <message>".
// Prepending (not appending) is deliberate: the write path stores this message in
// a `post_error` column capped at 500 chars, and Intuit fault bodies are often
// long — a trailing tid would be sliced off exactly on the failed-post path that
// most needs it. At the front it always survives truncation and heads every log
// line. Returns the message unchanged when there is no tid.
function withTid(message: string, tid: string | undefined): string {
  return tid ? `[intuit_tid: ${tid}] ${message}` : message;
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

// The go-live safety lock: PRODUCTION connections may only be stored when token
// encryption at rest is configured (QBO_TOKEN_ENC_KEY parses to a 32-byte key).
// Without this, one forgotten env var would silently store REAL clients' OAuth
// tokens as plaintext. Sandbox is exempt so local dev needs no key. Both the
// connect and callback routes refuse when this returns true.
export function quickbooksProductionKeyMissing(): boolean {
  return (
    quickbooksEnvironment() === "production" && !isTokenEncryptionConfigured()
  );
}

// Tax-line posting kill-switch. OFF unless QBO_TAX_LINES_ENABLED is exactly
// "true" (case-insensitive), so posting behaves exactly as before (gross total,
// no tax code) until the founder verifies the tax math on a real Canadian
// QuickBooks company and turns it on. Fails safe to OFF.
export function quickbooksTaxLinesEnabled(): boolean {
  return (
    (process.env.QBO_TAX_LINES_ENABLED ?? "").trim().toLowerCase() === "true"
  );
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

// Data-API base URL. Prefer the per-connection environment (passed in) over the
// global QBO_ENVIRONMENT switch, so flipping the global switch can never point an
// already-connected firm at the wrong QuickBooks. Falls back to the global switch
// when no environment is given.
export function quickbooksApiBaseUrl(
  environment?: QuickbooksEnvironment,
): string {
  const env = environment ?? quickbooksEnvironment();
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

// Build the Intuit authorization URL the browser is sent to. `state` is an
// opaque anti-forgery value we verify on the callback. The authorize endpoint is
// resolved from Intuit's discovery document (falling back to the well-known URL).
export async function buildAuthorizeUrl(state: string): Promise<string> {
  const { authorize } = await getOAuthEndpoints(quickbooksEnvironment());
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID?.trim() ?? "",
    response_type: "code",
    scope: ACCOUNTING_SCOPE,
    redirect_uri: quickbooksRedirectUri(),
    state,
  });
  return `${authorize}?${params.toString()}`;
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
  const accessSecs =
    typeof json.expires_in === "number" ? json.expires_in : 3600;
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

// Sleep helper for the retry backoff.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A 429 (rate limited) or any 5xx is a transient Intuit-side condition worth
// retrying; everything else is either success or a permanent client error.
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// POST a form body to Intuit's token endpoint (resolved from the discovery
// document) with automatic retry on TRANSIENT failures — a network error/timeout,
// a 429, or a 5xx — using a short exponential backoff. Returns the final Response
// for the caller to interpret: a permanent non-2xx (e.g. invalid_grant) is
// returned as-is, NOT retried. Throws QuickbooksError("request_failed") only after
// every attempt hit a network error / timeout.
async function fetchTokenEndpoint(body: string): Promise<Response> {
  const { token } = await getOAuthEndpoints(quickbooksEnvironment());
  let lastError: unknown;
  for (let attempt = 1; attempt <= TOKEN_RETRY_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(token, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      // Network error / timeout — transient. Back off and retry unless we're out
      // of attempts, then surface a request_failed.
      lastError = e;
      if (attempt < TOKEN_RETRY_MAX_ATTEMPTS) {
        await delay(TOKEN_RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new QuickbooksError(
        "request_failed",
        `QuickBooks token request failed after ${TOKEN_RETRY_MAX_ATTEMPTS} attempts: ${(e as Error).message}`,
      );
    }
    // Retry a transient HTTP status; otherwise return the response (success, or a
    // permanent error the caller will map).
    if (isTransientStatus(res.status) && attempt < TOKEN_RETRY_MAX_ATTEMPTS) {
      await delay(TOKEN_RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
    return res;
  }
  // Unreachable: the loop always returns or throws. Kept for exhaustiveness.
  throw new QuickbooksError(
    "request_failed",
    lastError instanceof Error
      ? lastError.message
      : "QuickBooks token request failed",
  );
}

// Exchange the one-time authorization code for tokens (the callback step).
export async function exchangeCodeForTokens(
  code: string,
): Promise<QuickbooksTokens> {
  if (!isQuickbooksConfigured()) {
    throw new QuickbooksError("not_configured", "QuickBooks is not configured");
  }
  const res = await fetchTokenEndpoint(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: quickbooksRedirectUri(),
    }).toString(),
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const tid = tidOf(res);
    throw new QuickbooksError(
      "token_exchange_failed",
      withTid(
        `QuickBooks token exchange failed (${res.status}): ${truncate(detail)}`,
        tid,
      ),
      res.status,
      tid,
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
  const res = await fetchTokenEndpoint(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const dead = /invalid_grant/i.test(detail);
    const tid = tidOf(res);
    throw new QuickbooksError(
      dead ? "invalid_grant" : "token_refresh_failed",
      withTid(
        `QuickBooks token refresh failed (${res.status}): ${truncate(detail)}`,
        tid,
      ),
      res.status,
      tid,
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
    const { revoke } = await getOAuthEndpoints(quickbooksEnvironment());
    const res = await fetch(revoke, {
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

// The connected company's identity: display name + country. The country drives
// whether GlobalTaxCalculation (a non-US-only field) is sent when posting with
// tax. Both fields fail soft to null (the connection is valid regardless).
export type CompanyProfile = { name: string | null; country: string | null };

// ONE identity-only read of CompanyInfo. NOT financial data, touches no
// transactions or documents. Returns { name: null, country: null } on any failure.
export async function fetchCompanyProfile(
  accessToken: string,
  realmId: string,
  environment?: QuickbooksEnvironment,
): Promise<CompanyProfile> {
  const empty: CompanyProfile = { name: null, country: null };
  const url =
    `${quickbooksApiBaseUrl(environment)}/v3/company/${encodeURIComponent(realmId)}` +
    `/companyinfo/${encodeURIComponent(realmId)}?minorversion=${QBO_MINORVERSION}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch {
    return empty;
  }
  if (!res.ok) {
    // Fail soft (the connection is still valid), but record the trace id so a
    // recurring identity-read failure is diagnosable with Intuit support.
    console.warn(
      withTid(`[quickbooks] company info read failed (${res.status})`, tidOf(res)),
    );
    return empty;
  }
  try {
    const json = (await res.json()) as {
      CompanyInfo?: { CompanyName?: string; Country?: string };
    };
    const name = json.CompanyInfo?.CompanyName?.trim();
    const country = json.CompanyInfo?.Country?.trim();
    return {
      name: name && name.length > 0 ? name : null,
      country: country && country.length > 0 ? country : null,
    };
  } catch {
    return empty;
  }
}

// Back-compat: the company's display name only (Stage 1 callers). Thin wrapper
// over fetchCompanyProfile.
export async function fetchCompanyName(
  accessToken: string,
  realmId: string,
  environment?: QuickbooksEnvironment,
): Promise<string | null> {
  return (await fetchCompanyProfile(accessToken, realmId, environment)).name;
}

// Run a read-only QBO query (the SQL-like /query endpoint) and return the raw
// QueryResponse object (e.g. { Account: [...], maxResults, startPosition }).
// Read-only — used to pull reference lists (accounts, vendors, customers, tax
// codes). Unlike fetchCompanyName (an identity read that fails soft to null),
// this THROWS a typed QuickbooksError so callers can tell an expired token /
// not-found / transient apart.
export async function quickbooksQuery(
  accessToken: string,
  realmId: string,
  query: string,
  environment?: QuickbooksEnvironment,
): Promise<Record<string, unknown>> {
  const url =
    `${quickbooksApiBaseUrl(environment)}/v3/company/${encodeURIComponent(realmId)}` +
    `/query?query=${encodeURIComponent(query)}&minorversion=${QBO_MINORVERSION}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new QuickbooksError(
      "request_failed",
      `QuickBooks query request failed: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const tid = tidOf(res);
    throw new QuickbooksError(
      "read_failed",
      withTid(`QuickBooks query failed (${res.status}): ${truncate(detail)}`, tid),
      res.status,
      tid,
    );
  }
  const json = (await res.json().catch(() => null)) as {
    QueryResponse?: Record<string, unknown>;
  } | null;
  return json?.QueryResponse ?? {};
}

// The minimal shape we read back from a created/voided transaction. A CREATE also
// surfaces QuickBooks' own computed totals (used to detect tax drift vs the
// document); they're absent on a delete and on responses that omit them.
export type QboEntityResult = {
  id: string;
  syncToken: string;
  totalAmt?: number | null; // transaction TotalAmt (gross) QuickBooks recorded
  totalTax?: number | null; // TxnTaxDetail.TotalTax QuickBooks computed
};

// Transaction entities we post: a Bill (unpaid expense), a Purchase (paid
// expense), an Invoice (income owed), or a SalesReceipt (income already
// received). The URL path is lowercase; the JSON response wraps the object under
// the capitalized name (e.g. { "Invoice": { Id, SyncToken } }).
// The transaction entities Vylan can post/match. Kept as one const array so the
// type, the runtime allowlist, and every parse point stay in lockstep — adding a
// fifth entity here updates all of them (a drifted per-route allowlist that
// silently dropped a valid entity is exactly the bug this prevents).
export const QBO_TXN_ENTITIES = [
  "bill",
  "invoice",
  "purchase",
  "salesreceipt",
] as const;
export type QboTxnEntity = (typeof QBO_TXN_ENTITIES)[number];
// Narrow untrusted input (a request body field) to a QboTxnEntity.
export function isQboTxnEntity(x: unknown): x is QboTxnEntity {
  return (
    typeof x === "string" &&
    (QBO_TXN_ENTITIES as readonly string[]).includes(x)
  );
}
function entityResponseKey(entity: QboTxnEntity): string {
  if (entity === "invoice") return "Invoice";
  if (entity === "purchase") return "Purchase";
  if (entity === "salesreceipt") return "SalesReceipt";
  return "Bill";
}

// CREATE a transaction in QuickBooks (Stage 5 — the first write). POSTs `body`
// to /v3/company/{realmId}/{entity}. `requestId` is Intuit's idempotency key: a
// retried POST with the SAME requestId returns the ORIGINAL transaction instead
// of creating a duplicate (so a lost response / double click can't double-post).
// The caller must pass a requestId that is STABLE for one logical post and FRESH
// after a void+re-post. Throws a typed QuickbooksError on any non-2xx.
export async function quickbooksCreate(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  entity: QboTxnEntity,
  body: Record<string, unknown>,
  requestId: string,
): Promise<QboEntityResult> {
  const url =
    `${quickbooksApiBaseUrl(ctx.environment)}/v3/company/${encodeURIComponent(ctx.realmId)}` +
    `/${entity}?minorversion=${QBO_MINORVERSION}&requestid=${encodeURIComponent(requestId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new QuickbooksError(
      "request_failed",
      `QuickBooks create request failed: ${(e as Error).message}`,
    );
  }
  const tid = tidOf(res);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new QuickbooksError(
      "write_failed",
      withTid(`QuickBooks create failed (${res.status}): ${truncate(detail)}`, tid),
      res.status,
      tid,
    );
  }
  const json = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return parseEntityResult(json, entityResponseKey(entity), tid);
}

// ── Name-list entities (Vendor / Customer) ──────────────────────────────────
// Created inline from the draft-card picker's "+ Create '<name>'" affordance when
// a receipt names a party that isn't in the firm's QuickBooks yet. These are
// NAME-list entities (not transactions), so they get their own tiny create/lookup
// pair rather than going through quickbooksCreate (which is transaction-shaped).
export type QboNameKind = "vendor" | "customer";
const NAME_KIND_RESPONSE_KEY: Record<QboNameKind, string> = {
  vendor: "Vendor",
  customer: "Customer",
};

// CREATE a Vendor or Customer from just a display name. Returns the new {id, name}
// (QuickBooks may normalize the stored DisplayName). Throws a typed QuickbooksError
// on any failure; a duplicate name surfaces as QBO code 6240 in the message so the
// caller can fall back to quickbooksFindNameEntityByName.
export async function quickbooksCreateNameEntity(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  kind: QboNameKind,
  displayName: string,
): Promise<{ id: string; name: string }> {
  const url =
    `${quickbooksApiBaseUrl(ctx.environment)}/v3/company/${encodeURIComponent(ctx.realmId)}` +
    `/${kind}?minorversion=${QBO_MINORVERSION}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ DisplayName: displayName }),
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new QuickbooksError(
      "request_failed",
      `QuickBooks create ${kind} request failed: ${(e as Error).message}`,
    );
  }
  const tid = tidOf(res);
  const json = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!res.ok) {
    // QBO returns the duplicate-name Fault (code 6240) in the 400 body; surface it
    // so isDuplicateNameError can route to the lookup fall-back.
    const fault = extractFault(json);
    throw new QuickbooksError(
      "write_failed",
      withTid(fault ?? `QuickBooks create ${kind} failed (${res.status})`, tid),
      res.status,
      tid,
    );
  }
  const fault = extractFault(json);
  if (fault) {
    throw new QuickbooksError("write_failed", withTid(fault, tid), undefined, tid);
  }
  const key = NAME_KIND_RESPONSE_KEY[kind];
  const entity = (json?.[key] ?? null) as Record<string, unknown> | null;
  const id = entity && typeof entity.Id === "string" ? entity.Id : null;
  const name =
    entity && typeof entity.DisplayName === "string"
      ? entity.DisplayName
      : displayName;
  if (!id) {
    throw new QuickbooksError(
      "write_failed",
      withTid("QuickBooks returned an unexpected response.", tid),
      undefined,
      tid,
    );
  }
  return { id, name };
}

// Look up an existing Vendor/Customer by EXACT display name. Used as the create
// affordance's fall-back: QuickBooks reported the name already exists (6240) but
// our cache hadn't caught it, so find the real id and use that instead of failing.
// Returns null when none matches.
export async function quickbooksFindNameEntityByName(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  kind: QboNameKind,
  displayName: string,
): Promise<{ id: string; name: string } | null> {
  const key = NAME_KIND_RESPONSE_KEY[kind];
  // Escape for the QBO query language: backslash-escape backslashes then quotes.
  const escaped = displayName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const result = await quickbooksQuery(
    ctx.accessToken,
    ctx.realmId,
    `SELECT Id, DisplayName FROM ${key} WHERE DisplayName = '${escaped}'`,
    ctx.environment,
  );
  const rows = (result[key] ?? []) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row || typeof row.Id !== "string") return null;
  return {
    id: row.Id,
    name: typeof row.DisplayName === "string" ? row.DisplayName : displayName,
  };
}

// Whether a thrown error is QuickBooks' "Duplicate Name Exists" (code 6240) — the
// signal to fall back to a by-name lookup instead of surfacing a hard failure.
// Matches the fault's TEXT ("Duplicate Name Exists Error", always present on a
// 6240) rather than the bare code "6240": the message also carries the intuit_tid
// (a hex trace id), which could coincidentally contain "6240" and misclassify an
// unrelated failure as a duplicate.
export function isDuplicateNameError(e: unknown): boolean {
  return e instanceof QuickbooksError && /duplicate name/i.test(e.message);
}

// DELETE a posted transaction (the Stage 5 undo). A QuickBooks BILL cannot be
// voided via the API (void is only for sales transactions / payments), so the
// undo is a delete: POST ?operation=delete with the entity Id + current
// SyncToken. QuickBooks still records the deletion in its own Audit Log. Throws
// a typed QuickbooksError on any non-2xx OR an in-body Fault.
export async function quickbooksDelete(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  entity: QboTxnEntity,
  id: string,
  syncToken: string,
): Promise<QboEntityResult> {
  const url =
    `${quickbooksApiBaseUrl(ctx.environment)}/v3/company/${encodeURIComponent(ctx.realmId)}` +
    `/${entity}?operation=delete&minorversion=${QBO_MINORVERSION}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Id: id, SyncToken: syncToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new QuickbooksError(
      "request_failed",
      `QuickBooks delete request failed: ${(e as Error).message}`,
    );
  }
  const tid = tidOf(res);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new QuickbooksError(
      "write_failed",
      withTid(`QuickBooks delete failed (${res.status}): ${truncate(detail)}`, tid),
      res.status,
      tid,
    );
  }
  // A delete only needs to have SUCCEEDED — we don't consume the returned id (the
  // create path does). QuickBooks can still return a 200 with a Fault (e.g. a
  // stale SyncToken or "object not found"); surface that. Otherwise it's done.
  const json = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const fault = extractFault(json);
  if (fault)
    throw new QuickbooksError("write_failed", withTid(fault, tid), undefined, tid);
  return { id, syncToken };
}

// Map a file's stored MIME (or its extension) to a type QuickBooks accepts for an
// attachment. QBO REJECTS application/octet-stream, so a missing/generic type is
// resolved from the filename extension; an unresolvable type returns null so the
// caller SKIPS the attach rather than sending a rejected upload. Exported for
// unit tests.
export function resolveAttachmentMime(
  mime: string | null,
  fileName: string,
): string | null {
  const supported: Record<string, string> = {
    "application/pdf": "application/pdf",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/gif": "image/gif",
    "image/tiff": "image/tiff",
    "image/bmp": "image/bmp",
  };
  const m = (mime ?? "").trim().toLowerCase();
  if (supported[m]) return supported[m];
  const byExt: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    tif: "image/tiff",
    tiff: "image/tiff",
    bmp: "image/bmp",
  };
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  return byExt[ext] ?? null;
}

// Rewrite the attachment's FileName extension to match the RESOLVED mime. The
// upload pipeline transcodes HEIC (iPhone) → JPEG (the stored bytes + mime become
// JPEG) but keeps the original ".heic" name; QuickBooks validates the FileName
// extension and rejects ".heic", so the attach would silently fail for phone
// photos. Rewriting to the canonical extension keeps the name honest and
// accepted. Exported for unit tests.
export function canonicalAttachmentName(fileName: string, mime: string): string {
  const canonExt: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/tiff": "tiff",
    "image/bmp": "bmp",
  };
  const want = canonExt[mime];
  if (!want) return fileName;
  const base = fileName.replace(/\.[^./\\]+$/, "") || "receipt";
  return `${base}.${want}`;
}

// Attach a source document (the receipt/invoice) to a POSTED QuickBooks
// transaction via the multipart /upload endpoint — one request both uploads the
// file AND links it to the transaction (Bill/Purchase/Invoice), giving the books
// audit evidence (Dext/Hubdoc parity). Throws a typed QuickbooksError on any
// failure so the post flow can log it and move on: a failed attach must never
// undo a real post. Node's global FormData + Blob builds the two required parts
// (file_metadata_01 JSON + file_content_01 bytes) with the correct PER-PART
// Content-Type; we must NOT set the request Content-Type (fetch adds the
// multipart boundary itself).
export async function quickbooksUploadAttachment(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  entity: QboTxnEntity,
  entityId: string,
  file: { bytes: Buffer; fileName: string; mime: string | null },
): Promise<void> {
  const mime = resolveAttachmentMime(file.mime, file.fileName);
  if (!mime) {
    throw new QuickbooksError(
      "request_failed",
      `Unsupported attachment type for "${truncate(file.fileName, 80)}"`,
    );
  }
  if (!file.bytes || file.bytes.length === 0) {
    throw new QuickbooksError("request_failed", "Empty attachment");
  }
  // Keep the FileName extension consistent with the actual bytes/mime (HEIC was
  // already transcoded to JPEG upstream) — QBO rejects a mismatched extension.
  const fileName = canonicalAttachmentName(file.fileName, mime);
  const metadata = {
    AttachableRef: [
      { EntityRef: { type: entityResponseKey(entity), value: String(entityId) } },
    ],
    FileName: fileName,
    ContentType: mime,
    Category: "Receipt",
  };
  const form = new FormData();
  form.append(
    "file_metadata_01",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    "attachment.json",
  );
  form.append(
    "file_content_01",
    new Blob([new Uint8Array(file.bytes)], { type: mime }),
    fileName,
  );
  const url =
    `${quickbooksApiBaseUrl(ctx.environment)}/v3/company/${encodeURIComponent(ctx.realmId)}/upload`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // No Content-Type header — fetch derives the multipart boundary from `form`.
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(QBO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new QuickbooksError(
      "request_failed",
      `QuickBooks attachment request failed: ${(e as Error).message}`,
    );
  }
  const tid = tidOf(res);
  const json = (await res.json().catch(() => null)) as {
    AttachableResponse?: Array<{ Attachable?: unknown; Fault?: unknown }>;
  } | null;
  const entry = json?.AttachableResponse?.[0] ?? null;
  // A 200 can still carry a per-file Fault, or an empty AttachableResponse — treat
  // a missing Attachable as failure.
  if (!res.ok || !entry || entry.Fault || !entry.Attachable) {
    const detail =
      extractFault((entry as Record<string, unknown> | null) ?? null) ??
      `status ${res.status}`;
    throw new QuickbooksError(
      "write_failed",
      withTid(`QuickBooks attachment failed (${res.status}): ${detail}`, tid),
      res.status,
      tid,
    );
  }
}

// Pull { Id, SyncToken } out of an Intuit create/delete response shaped like
// { "Bill": { "Id": "123", "SyncToken": "0", ... } }. QuickBooks can return a
// 200 with a Fault (a business-rule rejection, e.g. an unsupported operation) —
// surface that real message rather than a generic one. Throws write_failed if
// neither a usable entity Id nor a Fault is present, so the caller never records
// a bogus result.
function parseEntityResult(
  json: Record<string, unknown> | null,
  key: string,
  tid?: string,
): QboEntityResult {
  const fault = extractFault(json);
  if (fault)
    throw new QuickbooksError("write_failed", withTid(fault, tid), undefined, tid);
  const entity = (json?.[key] ?? null) as Record<string, unknown> | null;
  const id = entity && typeof entity.Id === "string" ? entity.Id : null;
  const syncToken =
    entity && typeof entity.SyncToken === "string" ? entity.SyncToken : "0";
  if (!id) {
    throw new QuickbooksError(
      "write_failed",
      withTid("QuickBooks returned an unexpected response.", tid),
      undefined,
      tid,
    );
  }
  return {
    id,
    syncToken,
    totalAmt: numOrNull(entity?.TotalAmt),
    totalTax: numOrNull(
      (entity?.TxnTaxDetail as { TotalTax?: unknown } | undefined)?.TotalTax,
    ),
  };
}

// Coerce a QuickBooks numeric field (sometimes a JSON number, sometimes a numeric
// string) to a number, or null when absent/unparseable.
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Pull a human-readable message out of an Intuit `Fault` element (returned on
// some 200 responses), e.g. { Fault: { Error: [{ Message, Detail }] } }.
function extractFault(json: Record<string, unknown> | null): string | null {
  const fault = (json?.Fault ?? null) as { Error?: unknown } | null;
  if (!fault) return null;
  const errors = Array.isArray(fault.Error) ? fault.Error : [];
  const first = (errors[0] ?? null) as {
    Message?: string;
    Detail?: string;
  } | null;
  const msg =
    first?.Detail || first?.Message || "QuickBooks rejected the request.";
  return truncate(msg);
}

// Cap any upstream error body we keep so a large/HTML error page can't bloat a
// log line. Tokens/keys never appear in these bodies.
function truncate(s: string, max = 500): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}
