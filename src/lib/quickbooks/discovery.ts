// QuickBooks (Intuit) OpenID discovery — resolve the OAuth 2.0 endpoints from
// Intuit's published discovery document instead of hardcoding them.
//
// Intuit recommends fetching the authorize / token / revoke endpoints from the
// OpenID Connect ".well-known" discovery document so an app always uses the
// current endpoints rather than URLs baked into the code. This module fetches and
// caches that document, and FALLS BACK to the well-known constants if it can't be
// reached — so a discovery outage can never break connect, refresh, or disconnect.
//
// The authorize/token/revoke endpoints are the same for sandbox and production
// (only the data-API host differs), but Intuit publishes a separate sandbox
// discovery document, so we key the cache by environment for correctness.

import type { QuickbooksEnvironment } from "./client";

// The published OpenID Connect discovery documents. Sandbox and production are
// DIFFERENT URLs (Intuit lists a dedicated sandbox document).
const DISCOVERY_URL: Record<QuickbooksEnvironment, string> = {
  production:
    "https://developer.api.intuit.com/.well-known/openid_configuration",
  sandbox:
    "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
};

// Well-known fallback endpoints — the exact values Intuit's discovery document
// returns today. Used ONLY when the discovery fetch fails, so the OAuth flow keeps
// working even if the discovery endpoint is briefly unreachable.
export const FALLBACK_ENDPOINTS: OAuthEndpoints = {
  authorize: "https://appcenter.intuit.com/connect/oauth2",
  token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

export type OAuthEndpoints = {
  authorize: string;
  token: string;
  revoke: string;
};

// The subset of the discovery document we consume.
type IntuitDiscoveryDoc = {
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  revocation_endpoint?: unknown;
};

// Bound the discovery fetch so a slow endpoint can never hang a connect request;
// same 10s ceiling as the other Intuit network calls (see client.ts).
const DISCOVERY_TIMEOUT_MS = 10_000;

// In-memory cache per environment. Endpoints are stable, so once resolved we reuse
// them for the life of the server process (no repeated discovery round-trips).
const cache = new Map<QuickbooksEnvironment, OAuthEndpoints>();

// Resolve the OAuth 2.0 endpoints for an environment, preferring Intuit's live
// discovery document and falling back to the well-known constants on ANY failure.
// Never throws — the OAuth flow always gets a usable set of endpoints.
export async function getOAuthEndpoints(
  environment: QuickbooksEnvironment,
): Promise<OAuthEndpoints> {
  const cached = cache.get(environment);
  if (cached) return cached;
  const resolved = await fetchDiscovery(environment);
  cache.set(environment, resolved);
  return resolved;
}

async function fetchDiscovery(
  environment: QuickbooksEnvironment,
): Promise<OAuthEndpoints> {
  try {
    const res = await fetch(DISCOVERY_URL[environment], {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Don't fail silently: a persistent discovery outage should be visible in
      // the logs even though we degrade gracefully to the well-known endpoints.
      const tid = res.headers?.get?.("intuit_tid");
      console.warn(
        `[quickbooks] discovery ${environment} fetch failed (${res.status})${
          tid ? ` [intuit_tid: ${tid}]` : ""
        }; using well-known endpoints`,
      );
      return FALLBACK_ENDPOINTS;
    }
    const doc = (await res.json().catch(() => null)) as IntuitDiscoveryDoc | null;
    // Take each endpoint from the document when it's a non-empty string; otherwise
    // fall back per-field, so a partial document still yields a complete set.
    return {
      authorize: str(doc?.authorization_endpoint) ?? FALLBACK_ENDPOINTS.authorize,
      token: str(doc?.token_endpoint) ?? FALLBACK_ENDPOINTS.token,
      revoke: str(doc?.revocation_endpoint) ?? FALLBACK_ENDPOINTS.revoke,
    };
  } catch (e) {
    console.warn(
      `[quickbooks] discovery ${environment} fetch errored (${
        (e as Error).message
      }); using well-known endpoints`,
    );
    return FALLBACK_ENDPOINTS;
  }
}

// A trimmed non-empty string, or null.
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// Test hook: drop the in-memory cache so a test can re-exercise the fetch path.
export function __clearDiscoveryCacheForTests(): void {
  cache.clear();
}
