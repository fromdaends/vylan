// Server-side PayPal REST client. SECRET STAYS HERE: nothing in this file is
// importable from client components (server-only fetches, no NEXT_PUBLIC).
//
// Auth is OAuth client_credentials with an in-memory token cache (PayPal
// sandbox tokens live ~9h; we refresh 60s early). Partner calls additionally
// carry:
//   * PayPal-Partner-Attribution-Id — our BN code, when configured (issued at
//     partner onboarding; optional in sandbox), and
//   * PayPal-Auth-Assertion — an unsigned JWT naming the SELLER the call acts
//     for (iss = our client id, payer_id = the seller's merchant id), per
//     PayPal's third-party integration docs.

import {
  isPayPalConfigured,
  paypalApiBase,
  paypalClientId,
  paypalClientSecret,
  paypalPartnerAttributionId,
} from "./config";

// base64url without padding (JWT alphabet), for the auth assertion.
function b64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// The unsigned ("alg":"none") auth-assertion JWT PayPal specifies for partners
// acting on behalf of a seller. Shape: header.payload. (trailing dot, empty
// signature).
export function buildAuthAssertion(
  clientId: string,
  sellerMerchantId: string,
): string {
  const header = b64url(JSON.stringify({ alg: "none" }));
  const payload = b64url(
    JSON.stringify({ iss: clientId, payer_id: sellerMerchantId }),
  );
  return `${header}.${payload}.`;
}

// ── Token cache ─────────────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAtMs: number } | null = null;

// Test hook: reset the module-level cache between tests.
export function _resetPayPalTokenCacheForTests(): void {
  cachedToken = null;
}

export async function getPayPalAccessToken(): Promise<string | null> {
  if (!isPayPalConfigured()) return null;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) {
    return cachedToken.token;
  }
  const id = paypalClientId()!;
  const secret = paypalClientSecret()!;
  let res: Response;
  try {
    res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
  } catch (e) {
    console.error("[paypal] token fetch failed:", e);
    return null;
  }
  if (!res.ok) {
    console.error("[paypal] token request rejected:", res.status);
    return null;
  }
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!data?.access_token) {
    console.error("[paypal] token response missing access_token");
    return null;
  }
  cachedToken = {
    token: data.access_token,
    expiresAtMs: now + (data.expires_in ?? 300) * 1000,
  };
  return cachedToken.token;
}

export type PayPalFetchResult = {
  status: number;
  // Parsed JSON body, or null (204 / non-JSON).
  json: unknown | null;
};

// One fetch wrapper for every PayPal API call. Returns a status + parsed body
// instead of throwing on API errors, so callers branch on PayPal's error names
// explicitly; returns null only when auth itself is impossible (not
// configured / token refused).
export async function paypalFetch(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    // When set, the call is made ON BEHALF OF this seller (adds the
    // PayPal-Auth-Assertion header).
    sellerMerchantId?: string;
    // Idempotency key for POSTs (PayPal-Request-Id).
    requestId?: string;
  } = {},
): Promise<PayPalFetchResult | null> {
  const token = await getPayPalAccessToken();
  if (!token) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const bn = paypalPartnerAttributionId();
  if (bn) headers["PayPal-Partner-Attribution-Id"] = bn;
  if (opts.sellerMerchantId) {
    headers["PayPal-Auth-Assertion"] = buildAuthAssertion(
      paypalClientId()!,
      opts.sellerMerchantId,
    );
  }
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  let res: Response;
  try {
    res = await fetch(`${paypalApiBase()}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    console.error("[paypal] fetch failed:", path, e);
    return null;
  }
  let json: unknown | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
