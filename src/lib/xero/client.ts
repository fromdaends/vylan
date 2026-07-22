// Xero OAuth + HTTP client — Phase 1 (connection only).
//
// Hand-rolled fetch wrapper mirroring src/lib/quickbooks/client.ts (no SDK).
// Xero differences that shape this file:
//   * Fixed endpoints (no discovery document): authorize at login.xero.com,
//     token at identity.xero.com.
//   * GRANULAR scopes (2026 model) — the broad accounting.transactions scope is
//     deprecated for new apps and must not be used.
//   * No sandbox/production key split: one app, one set of keys; the free
//     "Demo Company" org is the test target (flagged IsDemoCompany).
//   * The org ("tenant") id is NOT in the OAuth callback — after the token
//     exchange we GET /connections and filter by the authentication_event_id
//     claim inside the access-token JWT to find the org(s) just authorized.
//   * Access tokens last ~30 min; refresh tokens ~60 days, single-use ROTATING
//     (30-min grace) — the caller must persist BOTH tokens on every refresh.

const XERO_FETCH_TIMEOUT_MS = 10_000;
const TOKEN_RETRY_MAX_ATTEMPTS = 3;
const TOKEN_RETRY_BASE_MS = 300;

const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API_BASE_URL = "https://api.xero.com/api.xro/2.0";

// Granular scopes (Xero's 2026 model — accounting.transactions is deprecated).
// Requested up front so the accountant approves ONCE for everything the later
// phases need: creating bills/invoices (accounting.invoices), paid expense /
// income bank transactions (accounting.banktransactions), the unified contact
// list (accounting.contacts), reference data — accounts / tax rates / items /
// organisation (accounting.settings.read), receipt attachments
// (accounting.attachments), and offline_access for the refresh token.
export const XERO_SCOPES = [
  "offline_access",
  "accounting.invoices",
  "accounting.banktransactions",
  "accounting.contacts",
  "accounting.settings.read",
  "accounting.attachments",
].join(" ");

// The client-list IMPORT flow only READS contacts + the organisation and is
// released minutes later — ask for nothing more (least privilege; the consent
// screen shows read-only access). offline_access stays so the token response
// shape (refresh token present) is uniform.
export const XERO_IMPORT_SCOPES = [
  "offline_access",
  "accounting.contacts.read",
  "accounting.settings.read",
].join(" ");

// Xero refresh tokens live ~60 days from issuance and the token response does
// NOT echo a refresh-token lifetime (unlike Intuit's x_refresh_token_expires_in)
// — so the expiry is derived here. Slightly conservative is fine: the value only
// drives our own "stale, refresh soon" logic, never Xero's.
const XERO_REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export class XeroError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "token_exchange_failed"
      | "token_refresh_failed"
      | "invalid_grant"
      | "connections_failed"
      | "organisation_failed"
      | "request_failed",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "XeroError";
  }
}

import { isTokenEncryptionConfigured } from "@/lib/quickbooks/token-cipher";

// Go-live safety lock, mirroring the QuickBooks one: on the PRODUCTION runtime,
// never store Xero OAuth tokens while encryption at rest is unconfigured.
// Xero has no sandbox/production key split (every org's tokens are real), so
// the gate keys off the runtime environment instead of a provider env switch.
export function xeroTokenKeyMissing(): boolean {
  return (
    process.env.NODE_ENV === "production" && !isTokenEncryptionConfigured()
  );
}

// Both keys must be present for the integration to work; missing keys show a
// calm "not set up yet" note instead of erroring (same as QuickBooks/Stripe).
export function isXeroConfigured(): boolean {
  return Boolean(
    process.env.XERO_CLIENT_ID?.trim() && process.env.XERO_CLIENT_SECRET?.trim(),
  );
}

// The exact redirect URI Xero sends the accountant back to. Must match a URI
// registered on the Xero app EXACTLY; falls back to APP_URL so local dev works
// without extra config (Xero allows plain http://localhost for testing).
export function xeroRedirectUri(): string {
  const explicit = process.env.XERO_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api/integrations/xero/callback`;
}

// Build the Xero authorization URL the browser is sent to. `state` is the
// anti-forgery value the callback verifies.
export function buildXeroAuthorizeUrl(
  state: string,
  scope: string = XERO_SCOPES,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID?.trim() ?? "",
    redirect_uri: xeroRedirectUri(),
    scope,
    state,
  });
  return `${XERO_AUTHORIZE_URL}?${params.toString()}`;
}

export type XeroTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

type XeroTokenResponse = {
  token_type?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // access-token lifetime, seconds (~1800)
};

// Pure mapper from Xero's token JSON to absolute expiries (unit-testable; `nowMs`
// injected). The refresh expiry is DERIVED (60 days) — Xero doesn't send one.
export function xeroTokensFromResponse(
  json: XeroTokenResponse,
  nowMs: number,
): XeroTokens {
  if (!json.access_token || !json.refresh_token) {
    throw new XeroError(
      "token_exchange_failed",
      "Xero token response missing access_token or refresh_token",
    );
  }
  const accessSecs =
    typeof json.expires_in === "number" ? json.expires_in : 1800;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresAt: new Date(nowMs + accessSecs * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(
      nowMs + XERO_REFRESH_TOKEN_TTL_MS,
    ).toISOString(),
  };
}

// Decode the authentication_event_id claim from the access-token JWT — it keys
// GET /connections?authEventId=... to just the org(s) THIS consent authorized.
// Pure base64url decode of the payload segment; returns null on anything
// malformed (the caller then lists all connections and picks the newest).
export function authEventIdFromAccessToken(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { authentication_event_id?: unknown };
    return typeof json.authentication_event_id === "string" &&
      json.authentication_event_id
      ? json.authentication_event_id
      : null;
  } catch {
    return null;
  }
}

function basicAuthHeader(): string {
  const id = process.env.XERO_CLIENT_ID?.trim() ?? "";
  const secret = process.env.XERO_CLIENT_SECRET?.trim() ?? "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A 429 (rate limited) or any 5xx is transient and worth retrying; everything
// else is success or a permanent client error.
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// POST a form body to Xero's token endpoint with retry on TRANSIENT failures
// (network error/timeout, 429, 5xx) using a short exponential backoff. A
// permanent non-2xx (e.g. invalid_grant) is returned as-is, never retried.
async function fetchTokenEndpoint(body: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TOKEN_RETRY_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(XERO_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(XERO_FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      lastError = e;
      if (attempt < TOKEN_RETRY_MAX_ATTEMPTS) {
        await delay(TOKEN_RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new XeroError(
        "request_failed",
        `Xero token request failed after ${TOKEN_RETRY_MAX_ATTEMPTS} attempts: ${(e as Error).message}`,
      );
    }
    if (isTransientStatus(res.status) && attempt < TOKEN_RETRY_MAX_ATTEMPTS) {
      await delay(TOKEN_RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
    return res;
  }
  throw new XeroError(
    "request_failed",
    lastError instanceof Error ? lastError.message : "Xero token request failed",
  );
}

function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Exchange the one-time authorization code for tokens (the callback step).
export async function exchangeXeroCodeForTokens(
  code: string,
): Promise<XeroTokens> {
  if (!isXeroConfigured()) {
    throw new XeroError("not_configured", "Xero is not configured");
  }
  const res = await fetchTokenEndpoint(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: xeroRedirectUri(),
    }).toString(),
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new XeroError(
      "token_exchange_failed",
      `Xero token exchange failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as XeroTokenResponse;
  return xeroTokensFromResponse(json, Date.now());
}

// Exchange a refresh token for fresh tokens. Xero refresh tokens are SINGLE-USE
// rotating (30-min grace on the previous one), so the caller MUST persist both
// returned tokens. Throws "invalid_grant" when the refresh token is
// expired/revoked (the connection is dead — reconnect), vs
// "token_refresh_failed" for other errors.
export async function refreshXeroTokens(
  refreshToken: string,
): Promise<XeroTokens> {
  if (!isXeroConfigured()) {
    throw new XeroError("not_configured", "Xero is not configured");
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
    throw new XeroError(
      dead ? "invalid_grant" : "token_refresh_failed",
      `Xero token refresh failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as XeroTokenResponse;
  return xeroTokensFromResponse(json, Date.now());
}

export type XeroConnection = {
  // The app↔org link id — what DELETE /connections/{id} takes.
  connectionId: string;
  // The org id — what the Xero-tenant-id header takes.
  tenantId: string;
  tenantName: string | null;
  authEventId: string | null;
};

// List the orgs this token can access, optionally narrowed to one consent
// (authEventId). Called right after the token exchange to learn WHICH org the
// accountant just connected — Xero doesn't put it in the callback URL.
export async function fetchXeroConnections(
  accessToken: string,
  authEventId?: string | null,
): Promise<XeroConnection[]> {
  const url = authEventId
    ? `${XERO_CONNECTIONS_URL}?authEventId=${encodeURIComponent(authEventId)}`
    : XERO_CONNECTIONS_URL;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(XERO_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new XeroError(
      "connections_failed",
      `Xero connections read failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as Array<Record<string, unknown>>;
  return (Array.isArray(json) ? json : [])
    .filter((c) => typeof c.tenantId === "string" && c.tenantId)
    .map((c) => ({
      connectionId: typeof c.id === "string" ? c.id : "",
      tenantId: c.tenantId as string,
      tenantName: typeof c.tenantName === "string" ? c.tenantName : null,
      authEventId: typeof c.authEventId === "string" ? c.authEventId : null,
    }));
}

export type XeroOrganisationProfile = {
  name: string | null;
  countryCode: string | null;
  isDemo: boolean;
};

// One identity-only Organisation read at connect time (org name + country +
// demo flag for the card/badge). Requires the Xero-tenant-id header.
export async function fetchXeroOrganisation(
  accessToken: string,
  tenantId: string,
): Promise<XeroOrganisationProfile> {
  const res = await fetch(`${XERO_API_BASE_URL}/Organisation`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(XERO_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new XeroError(
      "organisation_failed",
      `Xero organisation read failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as {
    Organisations?: Array<Record<string, unknown>>;
  };
  const org = json.Organisations?.[0] ?? {};
  return {
    name: typeof org.Name === "string" ? org.Name : null,
    countryCode:
      typeof org.CountryCode === "string" ? org.CountryCode : null,
    isDemo: org.IsDemoCompany === true,
  };
}

// Disconnect ONE org (DELETE /connections/{connectionId}). Deliberately NOT the
// token-revocation endpoint: revoking the refresh token would kill EVERY org
// this Xero user connected — including other clients'. Best-effort: returns
// true on success, false on any failure, never throws — disconnect must still
// clear our local record even if Xero can't be reached.
export async function disconnectXeroConnection(
  accessToken: string,
  connectionId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${XERO_CONNECTIONS_URL}/${encodeURIComponent(connectionId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(XERO_FETCH_TIMEOUT_MS),
      },
    );
    return res.ok || res.status === 404; // already gone = disconnected
  } catch {
    return false;
  }
}

// ── Reference-list reads (Phase 2 cache sync) ────────────────────────────────
// Raw shapes: only the fields the cache keeps. Accounts / TaxRates / Items are
// full-list endpoints (no paging); Contacts is paged (100 default, 1000 max).

export type XeroRawAccount = {
  AccountID?: string;
  Code?: string;
  Name?: string;
  Type?: string; // BANK, EXPENSE, REVENUE, SALES, OVERHEADS, DIRECTCOSTS, CURRENT…
  Class?: string; // ASSET, EQUITY, EXPENSE, LIABILITY, REVENUE
  BankAccountType?: string; // BANK, CREDITCARD, PAYPAL (when Type=BANK)
  Status?: string; // ACTIVE, ARCHIVED
};
export type XeroRawContact = {
  ContactID?: string;
  Name?: string;
  ContactStatus?: string; // ACTIVE, ARCHIVED, GDPRREQUEST
  IsSupplier?: boolean;
  IsCustomer?: boolean;
};
export type XeroRawTaxRate = {
  TaxType?: string; // the code put on lines (e.g. CAN007)
  Name?: string;
  Status?: string; // ACTIVE, DELETED, ARCHIVED, PENDING
};
export type XeroRawItem = {
  ItemID?: string;
  Code?: string;
  Name?: string;
  IsSold?: boolean;
  SalesDetails?: { AccountCode?: string } | null;
  // Xero has no Status on items; a soft-deleted item simply isn't returned.
};

// GET a Xero Accounting endpoint (tenant-scoped) and return the named array.
// Throws XeroError on a non-2xx / network failure so the sync can mark itself
// partial and retry.
async function xeroGet(
  accessToken: string,
  tenantId: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${XERO_API_BASE_URL}/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(XERO_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new XeroError(
      "request_failed",
      `Xero ${path} read failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

// Chart of accounts (full list). includeArchived via the ?where filter so the
// cache carries inactive accounts too (mirrors QBO's Active IN (true,false)).
export async function fetchXeroAccounts(
  accessToken: string,
  tenantId: string,
): Promise<XeroRawAccount[]> {
  const json = await xeroGet(accessToken, tenantId, "Accounts");
  return (json.Accounts as XeroRawAccount[] | undefined) ?? [];
}

// Tax rates (full list). No paging, no If-Modified-Since.
export async function fetchXeroTaxRates(
  accessToken: string,
  tenantId: string,
): Promise<XeroRawTaxRate[]> {
  const json = await xeroGet(accessToken, tenantId, "TaxRates");
  return (json.TaxRates as XeroRawTaxRate[] | undefined) ?? [];
}

// Items (full list).
export async function fetchXeroItems(
  accessToken: string,
  tenantId: string,
): Promise<XeroRawItem[]> {
  const json = await xeroGet(accessToken, tenantId, "Items");
  return (json.Items as XeroRawItem[] | undefined) ?? [];
}

// Contacts — PAGED (100 default, 1000 max). Walk pages until a short one,
// including archived (?includeArchived=true) so the cache mirrors the org.
// Capped so a bad response can't loop forever.
const XERO_CONTACT_PAGE_SIZE = 1000;
const XERO_MAX_CONTACT_PAGES = 500;
export async function fetchXeroContactsAll(
  accessToken: string,
  tenantId: string,
): Promise<XeroRawContact[]> {
  const out: XeroRawContact[] = [];
  for (let page = 1; page <= XERO_MAX_CONTACT_PAGES; page++) {
    const json = await xeroGet(
      accessToken,
      tenantId,
      `Contacts?page=${page}&pageSize=${XERO_CONTACT_PAGE_SIZE}&includeArchived=true`,
    );
    const rows = (json.Contacts as XeroRawContact[] | undefined) ?? [];
    for (const r of rows) out.push(r);
    if (rows.length < XERO_CONTACT_PAGE_SIZE) return out; // short page → done
  }
  console.warn(
    `[xero] Contacts read hit the ${XERO_MAX_CONTACT_PAGES}-page cap (${out.length} rows); list may be truncated.`,
  );
  return out;
}

// ── Client import (Contacts of the firm's OWN org) ──────────────────────────

export type XeroImportCandidate = {
  display_name: string;
  email: string | null;
  phone: string | null;
};

// Pure mapper from Xero Contact rows to import candidates (unit-tested).
// Xero has ONE unified contact list: IsCustomer/IsSupplier are auto-set flags
// (only after a contact appears on a transaction). For a client-list import we
// keep customers AND un-flagged contacts, and drop pure suppliers + archived.
export function xeroContactCandidatesFromResponse(
  contacts: unknown,
): XeroImportCandidate[] {
  if (!Array.isArray(contacts)) return [];
  const out: XeroImportCandidate[] = [];
  for (const raw of contacts) {
    const c = raw as {
      Name?: unknown;
      ContactStatus?: unknown;
      IsCustomer?: unknown;
      IsSupplier?: unknown;
      EmailAddress?: unknown;
      Phones?: Array<{
        PhoneType?: unknown;
        PhoneNumber?: unknown;
        PhoneAreaCode?: unknown;
      }> | null;
    };
    const name = typeof c.Name === "string" ? c.Name.trim() : "";
    if (!name) continue;
    if (c.ContactStatus !== "ACTIVE") continue;
    // Pure supplier (vendor-only) → not one of the firm's clients.
    if (c.IsSupplier === true && c.IsCustomer !== true) continue;
    const email =
      typeof c.EmailAddress === "string" && c.EmailAddress.trim()
        ? c.EmailAddress.trim()
        : null;
    // Best-effort phone: the DEFAULT entry first, else the first with a number.
    const phones = Array.isArray(c.Phones) ? c.Phones : [];
    const pick =
      phones.find(
        (p) => p.PhoneType === "DEFAULT" && typeof p.PhoneNumber === "string" && p.PhoneNumber,
      ) ?? phones.find((p) => typeof p.PhoneNumber === "string" && p.PhoneNumber);
    const phone = pick
      ? `${typeof pick.PhoneAreaCode === "string" ? pick.PhoneAreaCode : ""}${pick.PhoneNumber as string}`.trim()
      : null;
    out.push({ display_name: name, email, phone: phone || null });
  }
  return out;
}

// Read the org's contacts (one 1000-row page — the same cap the CSV import
// commits). Called with the raw tokens from the exchange; the import flow
// releases the connection right after.
export async function fetchXeroContactCandidates(
  accessToken: string,
  tenantId: string,
): Promise<XeroImportCandidate[]> {
  const res = await fetch(
    `${XERO_API_BASE_URL}/Contacts?page=1&pageSize=1000`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(XERO_FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new XeroError(
      "request_failed",
      `Xero contacts read failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as { Contacts?: unknown };
  return xeroContactCandidatesFromResponse(json.Contacts ?? []);
}

// Is the access token expired, or close enough that we should refresh now?
// Missing/unparseable expiry reads as stale (refresh to be safe). Same shape as
// the QuickBooks helper; duplicated to keep the providers dependency-free of
// each other.
export function isXeroAccessTokenStale(
  expiresAt: string | null,
  nowMs: number,
  bufferMs = 5 * 60 * 1000,
): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t - bufferMs <= nowMs;
}
