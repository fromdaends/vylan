// The portal PIN gate — server-side enforcement.
//
// WHAT THIS GUARDS. The client portal has no login: whoever holds the
// 43-character link is the client. When a firm switches on a PIN for one
// client, that link stops being sufficient on its own until a 6-digit code is
// entered once per device.
//
// WHY IT LIVES HERE AND NOT IN THE PAGE. The visible page is only one of
// TWENTY-TWO doors into a client's portal data. The other twenty-one are API
// routes — file downloads, thumbnails, invoice PDFs, uploads, messages,
// payments, e-signature — and each one resolves the magic token itself. A gate
// that only hid the page would leave every file still downloadable by anyone
// holding the link, which is not a gate at all. So enforcement is wired into
// the two shared token->data resolvers in lib/db/portal.ts
// (findEngagementForToken, findItemForToken), and called explicitly by the ten
// routes that validate the token shape and then query on their own.
//
// NO IMPORTS FROM lib/db/portal.ts. That module imports THIS one, so anything
// needed here (the engagement lookup, the activity write) is done locally with
// the service role. It keeps the dependency one-directional and the gate
// impossible to accidentally short-circuit through a cycle.

import { cookies } from "next/headers";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isValidPinShape, pinMatches } from "./pin-cipher";

/** Failed attempts before this client's portal locks. */
export const PIN_MAX_ATTEMPTS = 5;
/** How long the lock lasts. */
export const PIN_LOCKOUT_MINUTES = 15;
/** Start showing "N attempts left" only after this many failures. */
export const PIN_HINT_AFTER_ATTEMPTS = 3;
/** How long a device stays remembered. */
export const PIN_REMEMBER_DAYS = 30;

/**
 * Cookie name is derived from a hash of the client id, not the id itself —
 * scoped per client (so one client's remembered device says nothing about
 * another's) without printing internal ids into the browser's cookie jar.
 */
export function deviceCookieName(clientId: string): string {
  const h = createHash("sha256").update(clientId).digest("hex").slice(0, 16);
  return `vy_pg_${h}`;
}

function signingKey(): Buffer | null {
  const raw = process.env.PORTAL_PIN_ENC_KEY?.trim();
  if (!raw) return null;
  for (const enc of ["base64", "hex"] as const) {
    try {
      const b = Buffer.from(raw, enc);
      if (b.length === 32) return b;
    } catch {
      /* try the next encoding */
    }
  }
  return null;
}

/**
 * Cookie value: "<expiry ms>.<hmac>". The signature covers the client id, the
 * client's CURRENT salt and the expiry, so:
 *   * it can't be forged without the server key,
 *   * it can't be replayed against another client,
 *   * and rotating the salt invalidates every outstanding cookie at once —
 *     which is exactly what regenerating or disabling the PIN does.
 */
export function signDeviceCookie(
  clientId: string,
  salt: string,
  expiresAtMs: number,
): string | null {
  const key = signingKey();
  if (!key) return null;
  const mac = createHmac("sha256", key)
    .update(`${clientId}.${salt}.${expiresAtMs}`)
    .digest("base64url");
  return `${expiresAtMs}.${mac}`;
}

export function verifyDeviceCookie(
  value: string | undefined,
  clientId: string,
  salt: string | null,
  nowMs: number,
): boolean {
  if (!value || !salt) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(value.slice(0, dot));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return false;
  const expected = signDeviceCookie(clientId, salt, expiresAtMs);
  if (!expected) return false;
  const a = Buffer.from(value, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type PinRow = {
  client_id: string;
  firm_id: string;
  enabled: boolean;
  encrypted: string | null;
  salt: string | null;
  failed_attempts: number;
  locked_until: string | null;
};

/**
 * The PIN state for the client behind a magic token, or null when the token
 * resolves to nothing. `enabled: false` is the overwhelmingly common answer —
 * the feature is off for every client by default.
 *
 * Tolerant of the columns not existing yet: before migration 1180 is applied,
 * the select errors and this reports "not enabled" rather than locking every
 * portal in production out. Deploy order safety, not a silent failure — after
 * the migration the real values are read.
 */
async function loadPinRowByToken(token: string): Promise<PinRow | null> {
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("client_id, firm_id")
    .eq("magic_token", token)
    .maybeSingle();
  if (!engagement) return null;
  return loadPinRowByClient(
    engagement.client_id as string,
    engagement.firm_id as string,
  );
}

function disabledRow(clientId: string, firmId: string): PinRow {
  return {
    client_id: clientId,
    firm_id: firmId,
    enabled: false,
    encrypted: null,
    salt: null,
    failed_attempts: 0,
    locked_until: null,
  };
}

async function loadPinRowByClient(
  clientId: string,
  firmId: string,
): Promise<PinRow | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("clients")
    .select(
      "portal_pin_enabled, portal_pin_encrypted, portal_pin_salt, portal_pin_failed_attempts, portal_pin_locked_until",
    )
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    // 42703 = undefined_column: the code is deployed but migration 1180 is not
    // applied yet. The feature cannot be on for anyone, so reporting "not
    // enabled" is the truth, not a bypass.
    if (error.code === "42703") return disabledRow(clientId, firmId);
    // Anything else is an unexpected failure, and we do NOT know whether this
    // client has a PIN. Throwing fails CLOSED — the caller errors out and
    // serves nothing. Swallowing it here would open a configured gate on a
    // transient database blip, which is the one outcome worth 500-ing over.
    throw new Error(`[portal-pin] gate lookup failed: ${error.message}`);
  }
  if (!data) return disabledRow(clientId, firmId);
  const row = data as Record<string, unknown>;
  return {
    client_id: clientId,
    firm_id: firmId,
    enabled: row.portal_pin_enabled === true,
    encrypted: (row.portal_pin_encrypted as string | null) ?? null,
    salt: (row.portal_pin_salt as string | null) ?? null,
    failed_attempts: Number(row.portal_pin_failed_attempts ?? 0),
    locked_until: (row.portal_pin_locked_until as string | null) ?? null,
  };
}

/** Read the remembered-device cookie. Never throws outside a request scope. */
async function readDeviceCookie(clientId: string): Promise<string | undefined> {
  try {
    const jar = await cookies();
    return jar.get(deviceCookieName(clientId))?.value;
  } catch {
    // Called from somewhere with no request context (a cron job, a test).
    // No cookie means no remembered device, which fails CLOSED.
    return undefined;
  }
}

export type GateVerdict =
  | { state: "open" }
  | { state: "needs_pin"; clientId: string; firmId: string }
  | { state: "locked"; clientId: string; firmId: string; until: string };

/**
 * The single question every entry point asks: may this request see portal data?
 *
 * "open" covers the default case (no PIN configured for this client) and the
 * remembered-device case. Anything else must not be served portal data.
 */
export async function checkPortalGate(token: string): Promise<GateVerdict> {
  const row = await loadPinRowByToken(token);
  // Unknown token: let the caller's own token validation produce the 404.
  if (!row) return { state: "open" };
  return checkPortalGateForRow(row, await readDeviceCookie(row.client_id));
}

function checkPortalGateForRow(
  row: PinRow,
  cookieValue: string | undefined,
): GateVerdict {
  if (!row.enabled || !row.encrypted) return { state: "open" };

  const now = Date.now();
  if (verifyDeviceCookie(cookieValue, row.client_id, row.salt, now)) {
    return { state: "open" };
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > now) {
    return {
      state: "locked",
      clientId: row.client_id,
      firmId: row.firm_id,
      until: row.locked_until,
    };
  }
  return { state: "needs_pin", clientId: row.client_id, firmId: row.firm_id };
}

/**
 * Boolean form for the twenty-two entry points: true when portal data may be
 * served. Used by findEngagementForToken / findItemForToken and called
 * directly by the routes that resolve tokens on their own.
 */
export async function isPortalUnlocked(token: string): Promise<boolean> {
  const verdict = await checkPortalGate(token);
  return verdict.state === "open";
}

/** Firm name + logo for the gate screen. Deliberately nothing else — the gate
 *  renders before any portal content is fetched, so this is all it may know. */
export async function loadGateBranding(token: string): Promise<{
  firmName: string;
  firmLogoPath: string | null;
  brandColor: string;
  clientLocale: "en" | "fr";
} | null> {
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("firm_id, client_id")
    .eq("magic_token", token)
    .maybeSingle();
  if (!engagement) return null;
  const [{ data: firm }, { data: client }] = await Promise.all([
    sb
      .from("firms")
      .select("name, logo_url, brand_color")
      .eq("id", engagement.firm_id as string)
      .maybeSingle(),
    sb
      .from("clients")
      .select("locale")
      .eq("id", engagement.client_id as string)
      .maybeSingle(),
  ]);
  if (!firm) return null;
  return {
    firmName: (firm.name as string) ?? "",
    firmLogoPath: (firm.logo_url as string | null) ?? null,
    brandColor: (firm.brand_color as string | null) ?? "#0a0a0c",
    clientLocale: (client?.locale as "en" | "fr") === "fr" ? "fr" : "en",
  };
}

export type PinAttemptResult =
  | { ok: true; cookieName: string; cookieValue: string; maxAgeSeconds: number }
  | { ok: false; reason: "wrong"; attemptsRemaining: number }
  | { ok: false; reason: "locked"; until: string }
  | { ok: false; reason: "unavailable" };

/**
 * Verify an attempted PIN and move the lockout counter.
 *
 * NEVER logs the attempted digits — the activity row records that an attempt
 * happened and whether it succeeded, nothing more. (Migration 0069 scrubbed
 * PII out of activity_log once already; this does not put any back.)
 */
export async function verifyPortalPinAttempt(
  token: string,
  attempt: string,
): Promise<PinAttemptResult> {
  const row = await loadPinRowByToken(token);
  if (!row || !row.enabled || !row.encrypted) {
    return { ok: false, reason: "unavailable" };
  }

  const sb = getServiceRoleSupabase();
  const now = Date.now();

  // Locked already: burn the attempt without touching the counter, so hammering
  // during a lockout can't extend it forever and can't be used as an oracle.
  if (row.locked_until && new Date(row.locked_until).getTime() > now) {
    await logGateActivity(row, "portal_pin_attempt_while_locked", {});
    return { ok: false, reason: "locked", until: row.locked_until };
  }

  if (!isValidPinShape(attempt) || !pinMatches(attempt, row.encrypted)) {
    const failed = row.failed_attempts + 1;
    const locks = failed >= PIN_MAX_ATTEMPTS;
    const lockedUntil = locks
      ? new Date(now + PIN_LOCKOUT_MINUTES * 60_000).toISOString()
      : null;
    await sb
      .from("clients")
      .update({
        portal_pin_failed_attempts: locks ? 0 : failed,
        portal_pin_locked_until: lockedUntil,
      })
      .eq("id", row.client_id);

    if (locks) {
      await logGateActivity(row, "portal_pin_locked", {
        minutes: PIN_LOCKOUT_MINUTES,
      });
      return { ok: false, reason: "locked", until: lockedUntil! };
    }
    await logGateActivity(row, "portal_pin_failed", {
      attempt_number: failed,
    });
    return {
      ok: false,
      reason: "wrong",
      attemptsRemaining: Math.max(0, PIN_MAX_ATTEMPTS - failed),
    };
  }

  // Correct. Clear the counter (a success after a lockout expires wipes the
  // slate) and hand back a signed cookie for the caller to set.
  await sb
    .from("clients")
    .update({
      portal_pin_failed_attempts: 0,
      portal_pin_locked_until: null,
    })
    .eq("id", row.client_id);
  await logGateActivity(row, "portal_pin_success", {});

  const maxAgeSeconds = PIN_REMEMBER_DAYS * 24 * 60 * 60;
  const cookieValue = signDeviceCookie(
    row.client_id,
    row.salt ?? "",
    now + maxAgeSeconds * 1000,
  );
  if (!cookieValue) return { ok: false, reason: "unavailable" };
  return {
    ok: true,
    cookieName: deviceCookieName(row.client_id),
    cookieValue,
    maxAgeSeconds,
  };
}

/**
 * Activity written inline rather than through lib/db/portal's logActivity, to
 * keep this module free of any import from the module that imports it. Same
 * table, same actor_type ("client" — the person at the gate has no account).
 */
async function logGateActivity(
  row: PinRow,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.from("activity_log").insert({
    firm_id: row.firm_id,
    engagement_id: null,
    actor_type: "client",
    action,
    metadata: { ...metadata, client_id: row.client_id },
  });
  if (error) console.error("[portal-pin] activity insert failed:", error);
}
