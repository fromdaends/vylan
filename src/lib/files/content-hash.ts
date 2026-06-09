import { createHash } from "crypto";

// SHA-256 hex fingerprint of a file's bytes. Used for duplicate detection: two
// byte-identical uploads produce the identical hash, so an exact re-upload can
// be spotted by comparing fingerprints instead of re-reading every other file.
// PURE + deterministic — a given byte sequence always maps to the same string.
export function computeContentHash(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
