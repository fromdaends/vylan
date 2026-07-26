// Storage-connection OAuth token encryption at rest (AES-256-GCM).
//
// Same design as the proven QuickBooks cipher (lib/quickbooks/token-cipher.ts),
// under its own key so rotating one integration's key never breaks the other:
//   * STORAGE_TOKEN_ENC_KEY unset -> helpers are graceful no-ops (plaintext),
//     so nothing breaks in dev before the key exists. The Google connect route
//     REFUSES to start a production flow without the key (fail closed there).
//   * "stov1:" prefix marks encrypted values; decrypt passes legacy plaintext
//     through, so mixed rows always work.
//   * A deterministic sha256 fingerprint of the PLAINTEXT refresh token backs
//     optimistic concurrency (GCM ciphertext is random per write and can't be
//     matched; storage_connections.refresh_token_fingerprint, migration 0900).

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

const PREFIX = "stov1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce (GCM standard)

// Parse STORAGE_TOKEN_ENC_KEY into a 32-byte key (base64 or hex). Null when
// unset/malformed — encryption stays OFF, failing safe to plaintext. Not
// cached, so tests can vary the env between calls.
function resolveKey(): Buffer | null {
  const raw = process.env.STORAGE_TOKEN_ENC_KEY?.trim();
  if (!raw) return null;
  const b64 = safeDecode(raw, "base64");
  if (b64 && b64.length === 32) return b64;
  const hex = safeDecode(raw, "hex");
  if (hex && hex.length === 32) return hex;
  console.error(
    "[filing] STORAGE_TOKEN_ENC_KEY is set but not a 32-byte base64/hex key; token encryption DISABLED",
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

export function isStorageTokenEncryptionConfigured(): boolean {
  return resolveKey() !== null;
}

export function encryptStorageToken(plaintext: string): string {
  const key = resolveKey();
  if (!key) throw new Error("storage token encryption key not configured");
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

/** Encrypt when the key is configured, else return plaintext unchanged. */
export function maybeEncryptStorageToken(plaintext: string): string {
  return resolveKey() ? encryptStorageToken(plaintext) : plaintext;
}

/**
 * Decrypt a stored token. Values without the "stov1:" marker are legacy
 * plaintext, returned as-is. Null when an encrypted value can't be decrypted
 * (missing/rotated key, tamper) — callers treat that as "reconnect needed".
 */
export function decryptStorageToken(stored: string): string | null {
  if (!stored.startsWith(`${PREFIX}:`)) return stored;
  const key = resolveKey();
  if (!key) {
    console.error(
      "[filing] encountered an encrypted token but STORAGE_TOKEN_ENC_KEY is not set",
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
    console.error("[filing] token decryption failed:", (e as Error).message);
    return null;
  }
}

/** sha256 hex of the PLAINTEXT refresh token — the concurrency match key. */
export function storageTokenFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
