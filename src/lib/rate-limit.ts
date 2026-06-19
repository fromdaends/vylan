// Distributed rate limiting backed by Upstash Redis. The module is designed
// to fail open when not configured: if UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN are missing, every check returns `{ ok: true }`
// so local dev and staging environments without Redis still work. In
// production these env vars MUST be set; missing values are flagged by the
// startup probe (see env.ts).
//
// Usage:
//   const r = await checkRateLimit({ key: `login:${ip}`, ...LOGIN_LIMIT });
//   if (!r.ok) return tooMany(r.retryAfter);

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Window = `${number} s` | `${number} m` | `${number} h` | `${number} d`;

export type LimitSpec = {
  limit: number;
  window: Window;
};

// ---- Tunables --------------------------------------------------------------

// Auth endpoints — strict against credential stuffing and signup abuse.
export const LOGIN_LIMIT: LimitSpec = { limit: 8, window: "1 m" };
export const SIGNUP_LIMIT: LimitSpec = { limit: 5, window: "1 h" };
export const PASSWORD_RESET_LIMIT: LimitSpec = { limit: 5, window: "1 h" };
// MFA verify — separate from LOGIN_LIMIT because the user is already
// past the password gate at this point. Tighter cap because each
// attempt is a guess at a small (6-digit / 12-hex) secret.
export const MFA_VERIFY_LIMIT: LimitSpec = { limit: 5, window: "5 m" };

// Portal endpoints — token-scoped (the magic token is the identity).
export const PORTAL_UPLOAD_PER_TOKEN: LimitSpec = { limit: 30, window: "1 h" };
export const PORTAL_UPLOAD_PER_IP: LimitSpec = { limit: 60, window: "1 h" };
// Chunked upload parts — a single 25 MB file arrives as up to 8 ~3.5 MB
// chunks, so the per-request budget must be several times the whole-file
// budget (30 files/h × 8 parts = 240).
export const PORTAL_UPLOAD_CHUNK_PER_TOKEN: LimitSpec = {
  limit: 240,
  window: "1 h",
};
export const PORTAL_UPLOAD_CHUNK_PER_IP: LimitSpec = {
  limit: 480,
  window: "1 h",
};
export const PORTAL_MUTATION_PER_TOKEN: LimitSpec = { limit: 120, window: "1 h" };
// Start a Stripe Checkout for a payment request. Tight: a real client clicks
// "Pay now" a handful of times at most; this only guards against scripted abuse
// of the unauthenticated endpoint.
export const PORTAL_CHECKOUT_PER_TOKEN: LimitSpec = { limit: 20, window: "1 h" };
export const PORTAL_CHECKOUT_PER_IP: LimitSpec = { limit: 40, window: "1 h" };
// Poll status — called by the portal after every upload at ~2s intervals
// for up to ~30s. Generous limit so a normal upload-heavy session never
// trips it: 30 polls × 30 uploads = 900 in the worst case, but realistic
// usage is well under that.
export const PORTAL_STATUS_PER_TOKEN: LimitSpec = { limit: 600, window: "1 h" };
// View a file thumbnail / file bytes. Each image is requested once per browser
// then cached for a day, but an engagement can hold MANY files and a client (or
// the accountant testing) may reload the portal repeatedly, so the cap must be
// generous: a too-low cap blocks EVERY thumbnail at once when tripped. These are
// cheap, scoped, browser-cached reads, so keep the ceiling high and only guard
// against egregious abuse.
export const PORTAL_FILE_VIEW_PER_TOKEN: LimitSpec = { limit: 6000, window: "1 h" };
export const PORTAL_FILE_VIEW_PER_IP: LimitSpec = { limit: 12000, window: "1 h" };

// AI / cost-bound endpoints.
export const AI_CLASSIFY_PER_FIRM_DAILY: LimitSpec = { limit: 500, window: "1 d" };

// In-app help assistant ("Ask Vylan") — costed per-user. Enough for a
// real support session (long back-and-forth = many turns) but tight
// enough that an abusive client can't drain spend in one sitting.
export const ASSISTANT_PER_USER: LimitSpec = { limit: 40, window: "1 h" };
export const ASSISTANT_PER_FIRM_DAILY: LimitSpec = { limit: 400, window: "1 d" };

// Firm-wide data export — generates a multi-MB ZIP of every client's
// files. Keep this tight so a stolen session can't drain the firm's
// data on a loop.
export const FIRM_EXPORT_LIMIT: LimitSpec = { limit: 1, window: "1 h" };

// Misc.
export const FEEDBACK_PER_USER: LimitSpec = { limit: 5, window: "1 h" };

// Public demo qualifying form (/[locale]/demo). Each full form
// completion is 3 submissions (one per step), so 60/h ≈ 20 full
// completions per IP per hour — enough to never trip during real
// founder testing, still well below scripted-spam volume (a bot
// would hit hundreds per minute). Tighten later if abuse appears.
export const DEMO_FORM_PER_IP: LimitSpec = { limit: 60, window: "1 h" };

// ---- Internals -------------------------------------------------------------

let redis: Redis | null = null;
const limiters = new Map<string, Ratelimit>();

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getLimiter(spec: LimitSpec): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const cacheKey = `${spec.limit}|${spec.window}`;
  const cached = limiters.get(cacheKey);
  if (cached) return cached;
  const lim = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(spec.limit, spec.window),
    analytics: false,
    prefix: "vylan_rl",
  });
  limiters.set(cacheKey, lim);
  return lim;
}

export type RateLimitResult = {
  ok: boolean;
  retryAfter?: number; // seconds
};

export async function checkRateLimit(args: {
  key: string;
  limit: number;
  window: Window;
}): Promise<RateLimitResult> {
  const limiter = getLimiter({ limit: args.limit, window: args.window });
  if (!limiter) return { ok: true };
  try {
    const res = await limiter.limit(args.key);
    if (res.success) return { ok: true };
    const retryAfter = Math.max(
      1,
      Math.ceil((res.reset - Date.now()) / 1000),
    );
    return { ok: false, retryAfter };
  } catch (e) {
    // Fail open on Redis transport errors — better to accept the request
    // than to lock the whole app out if Upstash hiccups.
    console.error("[rate-limit] check failed, failing open:", e);
    return { ok: true };
  }
}

// Convenience: pull the client IP off a NextRequest-like object. Vercel
// sets x-forwarded-for and strips client-set overrides, so this is safe to
// trust in production behind Vercel.
export function ipFromRequest(req: {
  headers: { get(name: string): string | null };
}): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
