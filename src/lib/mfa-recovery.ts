// Phase 6 MFA: recovery code helpers.
//
// 8 codes per user, generated once at enrollment, displayed once, hashed
// at rest. Codes are 12 hex characters formatted XXXX-XXXX-XXXX for
// readability. 48 bits of entropy per code — paired with the 5-per-5min
// rate limit on the verify endpoint, brute force is mathematically
// impossible. SHA-256 with the user_id as a salt is overkill but cheap.

import crypto from "node:crypto";

export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODE_LENGTH = 12; // hex characters, NO dashes
const GROUP_SIZE = 4;

/** Generate `RECOVERY_CODE_COUNT` codes, formatted for display. */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = crypto
      .randomBytes(RECOVERY_CODE_LENGTH / 2)
      .toString("hex");
    codes.push(formatRecoveryCode(raw));
  }
  return codes;
}

/** Insert dashes every GROUP_SIZE chars. Normalise to lowercase. */
export function formatRecoveryCode(raw: string): string {
  const lower = raw.toLowerCase();
  const groups: string[] = [];
  for (let i = 0; i < lower.length; i += GROUP_SIZE) {
    groups.push(lower.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}

/** Strip dashes/whitespace and lowercase so user input matches stored format. */
export function normalizeRecoveryCode(input: string): string {
  return input.trim().toLowerCase().replace(/[\s-]/g, "");
}

/** Detect at the input level whether the user is entering a TOTP or recovery code. */
export function looksLikeRecoveryCode(input: string): boolean {
  const stripped = normalizeRecoveryCode(input);
  return stripped.length === RECOVERY_CODE_LENGTH && /^[0-9a-f]+$/.test(stripped);
}

/**
 * Hash a recovery code together with the user_id. User-id-as-salt blocks
 * rainbow-table reuse across users without requiring a per-row salt
 * column.
 */
export function hashRecoveryCode(code: string, userId: string): string {
  const stripped = normalizeRecoveryCode(code);
  const data = `${userId}:${stripped}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}
