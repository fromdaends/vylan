// QuickBooks OAuth token encryption at rest (AES-256-GCM).
//
// The connection's access/refresh tokens are already service-role-read-only at the
// DB grant level (migration 0410). This adds encryption AT REST as defense in depth
// and to satisfy Intuit's production-app requirements: an exposed DB dump/backup
// still can't reveal the tokens without the key.
//
// Fully OPTIONAL + graceful. When QBO_TOKEN_ENC_KEY is unset the helpers are no-ops
// (store/return plaintext, exactly as before) so nothing breaks before go-live.
// Turning it on is one env var + one migration (0480), and it activates lazily:
// each token is (re)encrypted on its next write (a token refresh happens ~hourly),
// so there is no big-bang re-encrypt. `decryptToken` transparently passes through
// legacy plaintext values, so a mix of encrypted + plaintext rows always works.
//
// Optimistic concurrency: updateFirmQuickbooksTokens matches on the refresh token
// to avoid clobbering a rotated token. Since GCM ciphertext is non-deterministic
// (random IV), the raw encrypted value can't be matched. We therefore store a
// deterministic sha256 FINGERPRINT of the (plaintext) refresh token (0480) and
// match on that instead — same fingerprint Postgres backfills for existing rows.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

// Marks an encrypted value: "qbov1:<ivB64>:<tagB64>:<ciphertextB64>". Intuit
// tokens never start with this, so its presence unambiguously means "encrypted".
const PREFIX = "qbov1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce (GCM standard)

// Parse QBO_TOKEN_ENC_KEY into a 32-byte key, accepting base64 or hex. Returns
// null when unset or malformed (encryption then stays OFF, failing safe to
// plaintext). Not cached, so a test can vary the env between calls.
function resolveKey(): Buffer | null {
  const raw = process.env.QBO_TOKEN_ENC_KEY?.trim();
  if (!raw) return null;
  // Try base64 first (44 chars for 32 bytes), then hex (64 chars); the exact
  // 32-byte length check disambiguates which encoding it actually is.
  const b64 = safeDecode(raw, "base64");
  if (b64 && b64.length === 32) return b64;
  const hex = safeDecode(raw, "hex");
  if (hex && hex.length === 32) return hex;
  console.error(
    "[quickbooks] QBO_TOKEN_ENC_KEY is set but not a 32-byte base64/hex key; token encryption DISABLED",
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

// Is at-rest token encryption configured (a valid key present)?
export function isTokenEncryptionConfigured(): boolean {
  return resolveKey() !== null;
}

// Encrypt a token. Throws if no key — callers use maybeEncryptToken to gate.
export function encryptToken(plaintext: string): string {
  const key = resolveKey();
  if (!key) throw new Error("QBO token encryption key not configured");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

// Encrypt when a key is configured, otherwise return the plaintext unchanged so
// the caller stores today's format. Idempotent for storage: no key => passthrough.
export function maybeEncryptToken(plaintext: string): string {
  return resolveKey() ? encryptToken(plaintext) : plaintext;
}

// Decrypt a stored token. A value WITHOUT the "qbov1:" marker is legacy plaintext
// and returned as-is (so a not-yet-migrated row still works). Returns null when an
// encrypted value can't be decrypted (missing/rotated key, tamper) — the caller
// treats that as "connection unusable" rather than crashing.
export function decryptToken(stored: string): string | null {
  if (!stored.startsWith(`${PREFIX}:`)) return stored; // legacy plaintext
  const key = resolveKey();
  if (!key) {
    console.error(
      "[quickbooks] encountered an encrypted token but QBO_TOKEN_ENC_KEY is not set",
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
    console.error(
      "[quickbooks] token decryption failed:",
      (e as Error).message,
    );
    return null;
  }
}

// A deterministic sha256 (hex) of the PLAINTEXT refresh token, used as the
// optimistic-concurrency match key (migration 0480 stores + backfills the same
// value via the built-in encode(sha256(convert_to(refresh_token,'UTF8')),'hex')).
export function tokenFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
