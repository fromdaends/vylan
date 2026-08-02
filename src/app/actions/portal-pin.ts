"use server";

// Portal PIN actions — the client-side gate submission, and the four firm-side
// operations on the client profile.
//
// The firm-side actions all write through getServerSupabase(), so RLS scopes
// every read and write to the caller's own firm; the extra .eq("firm_id") is
// belt-and-braces on top of that. Both owners and staff may manage a PIN, in
// line with the rest of the client profile — there is no extra capability
// gate here on purpose.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getServerSupabase } from "@/lib/supabase/server";
import { logUserActivity } from "@/lib/db/activity";
import {
  decryptPortalPin,
  encryptPortalPin,
  generatePinSalt,
  generatePortalPin,
  isPortalPinEncryptionConfigured,
} from "@/lib/portal/pin-cipher";
import {
  PIN_REMEMBER_DAYS,
  verifyPortalPinAttempt,
  type PinAttemptResult,
} from "@/lib/portal/gate";

// ─── Client side: the gate ────────────────────────────────────────────────

/**
 * Submit an attempted PIN from the portal gate.
 *
 * Returns the verdict and, on success, sets the remembered-device cookie.
 * The cookie is httpOnly (JavaScript on the page can never read or forge it),
 * sameSite lax so it survives the client clicking through from an email, and
 * secure outside development.
 */
export async function submitPortalPinAction(
  token: string,
  pin: string,
): Promise<Exclude<PinAttemptResult, { ok: true }> | { ok: true }> {
  const result = await verifyPortalPinAttempt(token, pin);
  if (!result.ok) return result;

  const jar = await cookies();
  jar.set(result.cookieName, result.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: result.maxAgeSeconds,
  });
  return { ok: true };
}

// ─── Firm side: the client profile card ───────────────────────────────────

export type PinAdminResult =
  | { ok: true; pin?: string }
  | { ok: false; error: "no_session" | "unavailable" | "failed" };

async function firmContext() {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return null;
  return { user, firm };
}

/**
 * Turn the PIN on or off for one client.
 *
 * Turning it ON generates the PIN immediately — there is no separate "create a
 * code" step, because a toggle that leaves the feature half-configured is a
 * toggle that locks a client out. Turning it OFF clears the stored PIN AND
 * rotates the salt, so re-enabling later never resurrects an old code or an
 * old remembered device.
 */
export async function setPortalPinEnabledAction(
  clientId: string,
  enabled: boolean,
): Promise<PinAdminResult> {
  const ctx = await firmContext();
  if (!ctx) return { ok: false, error: "no_session" };

  if (enabled && !isPortalPinEncryptionConfigured()) {
    // Fail closed: refuse rather than store a PIN we cannot encrypt.
    return { ok: false, error: "unavailable" };
  }

  const sb = await getServerSupabase();
  const patch = enabled
    ? {
        portal_pin_enabled: true,
        portal_pin_encrypted: encryptPortalPin(generatePortalPin()),
        portal_pin_salt: generatePinSalt(),
        portal_pin_set_at: new Date().toISOString(),
        portal_pin_failed_attempts: 0,
        portal_pin_locked_until: null,
      }
    : {
        portal_pin_enabled: false,
        portal_pin_encrypted: null,
        portal_pin_salt: generatePinSalt(),
        portal_pin_set_at: null,
        portal_pin_failed_attempts: 0,
        portal_pin_locked_until: null,
      };

  const { error } = await sb
    .from("clients")
    .update(patch)
    .eq("id", clientId)
    .eq("firm_id", ctx.firm.id);
  if (error) {
    if (error.code === "42703") return { ok: false, error: "unavailable" };
    console.error("[portal-pin] toggle failed:", error.message);
    return { ok: false, error: "failed" };
  }

  await logUserActivity(
    ctx.firm.id,
    null,
    enabled ? "portal_pin_enabled" : "portal_pin_disabled",
    { client_id: clientId },
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Replace the PIN with a fresh one. Rotating the salt in the same write is what
 * makes the confirmation dialog's promise true: every remembered device stops
 * being remembered the moment this returns.
 */
export async function regeneratePortalPinAction(
  clientId: string,
): Promise<PinAdminResult> {
  const ctx = await firmContext();
  if (!ctx) return { ok: false, error: "no_session" };
  if (!isPortalPinEncryptionConfigured()) {
    return { ok: false, error: "unavailable" };
  }

  const pin = generatePortalPin();
  const sb = await getServerSupabase();
  const { error } = await sb
    .from("clients")
    .update({
      portal_pin_encrypted: encryptPortalPin(pin),
      portal_pin_salt: generatePinSalt(),
      portal_pin_set_at: new Date().toISOString(),
      portal_pin_failed_attempts: 0,
      portal_pin_locked_until: null,
    })
    .eq("id", clientId)
    .eq("firm_id", ctx.firm.id)
    .eq("portal_pin_enabled", true);
  if (error) {
    if (error.code === "42703") return { ok: false, error: "unavailable" };
    console.error("[portal-pin] regenerate failed:", error.message);
    return { ok: false, error: "failed" };
  }

  await logUserActivity(ctx.firm.id, null, "portal_pin_regenerated", {
    client_id: clientId,
  });
  revalidatePath("/", "layout");
  // The new PIN goes straight back to the person who asked for it, so they can
  // read it to the client. This is the only other place plaintext leaves the
  // server, and it is audit-logged above.
  return { ok: true, pin };
}

/**
 * Read the current PIN back in plain text.
 *
 * This is the ONLY read path for the plaintext, and it is deliberately an
 * action rather than a field on the page: the PIN must never ride along in the
 * profile's HTML, and every reveal has to leave a trace of who looked.
 */
export async function revealPortalPinAction(
  clientId: string,
): Promise<PinAdminResult> {
  const ctx = await firmContext();
  if (!ctx) return { ok: false, error: "no_session" };

  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("clients")
    .select("portal_pin_encrypted")
    .eq("id", clientId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (error) {
    if (error.code === "42703") return { ok: false, error: "unavailable" };
    return { ok: false, error: "failed" };
  }

  const pin = decryptPortalPin(
    (data as { portal_pin_encrypted: string | null } | null)
      ?.portal_pin_encrypted ?? null,
  );
  if (!pin) return { ok: false, error: "unavailable" };

  await logUserActivity(ctx.firm.id, null, "portal_pin_revealed", {
    client_id: clientId,
  });
  return { ok: true, pin };
}

/** How long a device stays trusted, for the profile card's copy. */
export async function portalPinRememberDays(): Promise<number> {
  return PIN_REMEMBER_DAYS;
}
