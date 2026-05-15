import { describe, it, expect } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from "./mfa-recovery";

describe("generateRecoveryCodes", () => {
  it("produces RECOVERY_CODE_COUNT unique codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("formats each code as 3 groups of 4 hex chars separated by dashes", () => {
    for (const c of generateRecoveryCodes()) {
      expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    }
  });
});

describe("normalizeRecoveryCode", () => {
  it("strips dashes, whitespace, and lowercases", () => {
    expect(normalizeRecoveryCode("AB12-3CD4-5e6f")).toBe("ab123cd45e6f");
    expect(normalizeRecoveryCode("  ab12 3cd4 5e6f  ")).toBe("ab123cd45e6f");
    expect(normalizeRecoveryCode("ab-12-3c-d4-5e-6f")).toBe("ab123cd45e6f");
  });
});

describe("looksLikeRecoveryCode", () => {
  it("accepts a well-formed 12-hex code with or without dashes", () => {
    expect(looksLikeRecoveryCode("ab12-3cd4-5e6f")).toBe(true);
    expect(looksLikeRecoveryCode("AB123CD45E6F")).toBe(true);
  });

  it("rejects non-hex strings and wrong-length inputs", () => {
    expect(looksLikeRecoveryCode("123456")).toBe(false); // 6-digit TOTP
    expect(looksLikeRecoveryCode("xyz-1234-5e6f")).toBe(false); // non-hex
    expect(looksLikeRecoveryCode("ab123cd45e6f00")).toBe(false); // too long
    expect(looksLikeRecoveryCode("")).toBe(false);
  });
});

describe("hashRecoveryCode", () => {
  it("is deterministic for the same code + user_id", () => {
    const a = hashRecoveryCode("ab12-3cd4-5e6f", "user-1");
    const b = hashRecoveryCode("ab12-3cd4-5e6f", "user-1");
    expect(a).toBe(b);
  });

  it("differs for the same code but a different user_id (salt)", () => {
    const a = hashRecoveryCode("ab12-3cd4-5e6f", "user-1");
    const b = hashRecoveryCode("ab12-3cd4-5e6f", "user-2");
    expect(a).not.toBe(b);
  });

  it("ignores formatting differences (dashes / case / whitespace)", () => {
    const a = hashRecoveryCode("ab12-3cd4-5e6f", "user-1");
    const b = hashRecoveryCode("AB12 3CD4 5E6F", "user-1");
    expect(a).toBe(b);
  });
});

describe("formatRecoveryCode", () => {
  it("groups every 4 hex chars with dashes", () => {
    expect(formatRecoveryCode("ab123cd45e6f")).toBe("ab12-3cd4-5e6f");
  });

  it("lowercases input", () => {
    expect(formatRecoveryCode("AB123CD45E6F")).toBe("ab12-3cd4-5e6f");
  });
});
