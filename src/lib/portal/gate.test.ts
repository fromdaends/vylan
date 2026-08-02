// Cookie signing + verification for "remember this device".
//
// These are the pure, dependency-free halves of the gate. The DB-driven parts
// (lockout counting, the verdict) need a Supabase client and are covered by the
// live check rather than mocked into meaninglessness here.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deviceCookieName,
  signDeviceCookie,
  verifyDeviceCookie,
  PIN_MAX_ATTEMPTS,
  PIN_LOCKOUT_MINUTES,
  PIN_REMEMBER_DAYS,
} from "./gate";

const KEY = Buffer.alloc(32, 3).toString("base64");
const CLIENT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SALT = "salt-one";
const NOW = 1_700_000_000_000;
const LATER = NOW + PIN_REMEMBER_DAYS * 24 * 60 * 60 * 1000;

describe("remember-this-device cookie", () => {
  const original = process.env.PORTAL_PIN_ENC_KEY;
  beforeEach(() => {
    process.env.PORTAL_PIN_ENC_KEY = KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PORTAL_PIN_ENC_KEY;
    else process.env.PORTAL_PIN_ENC_KEY = original;
  });

  it("accepts a cookie it just signed", () => {
    const v = signDeviceCookie(CLIENT, SALT, LATER)!;
    expect(verifyDeviceCookie(v, CLIENT, SALT, NOW)).toBe(true);
  });

  it("rejects it once it has expired", () => {
    const v = signDeviceCookie(CLIENT, SALT, NOW + 1000)!;
    expect(verifyDeviceCookie(v, CLIENT, SALT, NOW + 2000)).toBe(false);
  });

  // Regenerating the PIN (or disabling + re-enabling) rotates the salt. That
  // rotation is the ONLY thing invalidating already-trusted devices, so if this
  // test ever goes green-to-red the confirmation dialog starts telling a lie.
  it("rejects it after the salt rotates — this is what Regenerate relies on", () => {
    const v = signDeviceCookie(CLIENT, SALT, LATER)!;
    expect(verifyDeviceCookie(v, CLIENT, "salt-two", NOW)).toBe(false);
  });

  it("cannot be replayed against a different client", () => {
    const v = signDeviceCookie(CLIENT, SALT, LATER)!;
    expect(verifyDeviceCookie(v, OTHER, SALT, NOW)).toBe(false);
  });

  it("cannot be forged by extending the expiry", () => {
    const v = signDeviceCookie(CLIENT, SALT, LATER)!;
    const mac = v.slice(v.indexOf(".") + 1);
    const forged = `${LATER + 999_999_999}.${mac}`;
    expect(verifyDeviceCookie(forged, CLIENT, SALT, NOW)).toBe(false);
  });

  it("cannot be forged with a different signing key", () => {
    const v = signDeviceCookie(CLIENT, SALT, LATER)!;
    process.env.PORTAL_PIN_ENC_KEY = Buffer.alloc(32, 4).toString("base64");
    expect(verifyDeviceCookie(v, CLIENT, SALT, NOW)).toBe(false);
  });

  it("rejects junk, empties and missing salts", () => {
    expect(verifyDeviceCookie(undefined, CLIENT, SALT, NOW)).toBe(false);
    expect(verifyDeviceCookie("", CLIENT, SALT, NOW)).toBe(false);
    expect(verifyDeviceCookie("nonsense", CLIENT, SALT, NOW)).toBe(false);
    expect(verifyDeviceCookie(".abc", CLIENT, SALT, NOW)).toBe(false);
    expect(verifyDeviceCookie("abc.def", CLIENT, SALT, NOW)).toBe(false);
    const v = signDeviceCookie(CLIENT, SALT, LATER)!;
    expect(verifyDeviceCookie(v, CLIENT, null, NOW)).toBe(false);
  });

  it("signs nothing when the key is unset", () => {
    delete process.env.PORTAL_PIN_ENC_KEY;
    expect(signDeviceCookie(CLIENT, SALT, LATER)).toBeNull();
  });

  it("names the cookie per client, without printing the client id", () => {
    const a = deviceCookieName(CLIENT);
    const b = deviceCookieName(OTHER);
    expect(a).not.toBe(b);
    expect(a).not.toContain(CLIENT);
    expect(a).toMatch(/^vy_pg_[0-9a-f]{16}$/);
    expect(deviceCookieName(CLIENT)).toBe(a); // stable across calls
  });

  it("holds the lockout policy the spec asked for", () => {
    expect(PIN_MAX_ATTEMPTS).toBe(5);
    expect(PIN_LOCKOUT_MINUTES).toBe(15);
    expect(PIN_REMEMBER_DAYS).toBe(30);
  });
});
