// Portal PIN encryption at rest (AES-256-GCM), plus the PIN generator.
//
// Same shape as the proven QuickBooks / storage ciphers
// (lib/quickbooks/token-cipher.ts, lib/filing/token-cipher.ts), under its own
// key so rotating one never breaks the others.
//
// ONE DELIBERATE DIFFERENCE FROM THOSE TWO: they fall back to storing
// PLAINTEXT when their key is unset, so a dev machine keeps working. This one
// does NOT. A PIN is a credential; silently writing it in the clear because an
// env var is missing is the exact failure you never want to discover later. So
// encryptPortalPin THROWS with no key, and the server action that enables the
// feature refuses rather than storing anything. Fails closed, always.
//
// WHY ENCRYPTED AND NOT HASHED: the firm must be able to read the PIN back to
// tell the client what it is, and there is no self-service reset. A one-way
// hash would make the feature impossible. The full tradeoff is written out in
// supabase/migrations/1180_portal_pin.sql.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const PREFIX = "pinv1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce (GCM standard)

export const PIN_LENGTH = 6;

/**
 * Parse PORTAL_PIN_ENC_KEY into a 32-byte key (base64 or hex). Null when
 * unset/malformed. Not cached, so tests can vary the env between calls.
 */
function resolveKey(): Buffer | null {
  const raw = process.env.PORTAL_PIN_ENC_KEY?.trim();
  if (!raw) return null;
  const b64 = safeDecode(raw, "base64");
  if (b64 && b64.length === 32) return b64;
  const hex = safeDecode(raw, "hex");
  if (hex && hex.length === 32) return hex;
  console.error(
    "[portal-pin] PORTAL_PIN_ENC_KEY is set but is not a 32-byte base64/hex key; the portal PIN feature is DISABLED",
  );
  return null;
}

function safeDecode(s: string, enc: "base64" | "hex"): Buffer | null {
  try {
    return Buffer.from(s, enc);
  } catch {
    return null;
  }
}

/** Whether the PIN feature can be switched on at all. */
export function isPortalPinEncryptionConfigured(): boolean {
  return resolveKey() !== null;
}

/**
 * A fresh 6-digit PIN. randomInt is a uniform CSPRNG draw — no modulo bias,
 * so all 1,000,000 codes are equally likely. Zero-padded, so "000042" is a
 * legitimate PIN and the leading zeros must survive every round trip (this is
 * why the value is a string everywhere and never a number).
 */
export function generatePortalPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(PIN_LENGTH, "0");
}

/** Exactly six ASCII digits. */
export function isValidPinShape(pin: string): boolean {
  return /^[0-9]{6}$/.test(pin);
}

/** Random per-client salt for the remember-this-device cookie signature. */
export function generatePinSalt(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Encrypt a PIN. THROWS when no key is configured — callers must surface that
 * as "can't turn this on yet" rather than storing a readable PIN.
 */
export function encryptPortalPin(pin: string): string {
  const key = resolveKey();
  if (!key) throw new Error("PORTAL_PIN_ENC_KEY is not configured");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored PIN. Null on anything unexpected — missing key, rotated
 * key, tampered ciphertext, or a legacy/plaintext value.
 *
 * Note the difference from the storage cipher, which passes unprefixed values
 * through as legacy plaintext. There is no legacy here: this column was born
 * encrypted, so an unprefixed value means something is wrong and we refuse it.
 */
export function decryptPortalPin(stored: string | null): string | null {
  if (!stored || !stored.startsWith(`${PREFIX}:`)) return null;
  const key = resolveKey();
  if (!key) {
    console.error(
      "[portal-pin] found an encrypted PIN but PORTAL_PIN_ENC_KEY is not set",
    );
    return null;
  }
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ct = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch (e) {
    console.error("[portal-pin] decryption failed:", (e as Error).message);
    return null;
  }
}

/**
 * Compare an attempted PIN against the stored one in constant time, so the
 * comparison itself never leaks which digit went wrong. Both sides are
 * length-checked first because timingSafeEqual throws on a length mismatch.
 */
export function pinMatches(attempt: string, stored: string | null): boolean {
  const actual = decryptPortalPin(stored);
  if (!actual) return false;
  const a = Buffer.from(attempt, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
