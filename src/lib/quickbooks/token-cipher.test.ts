import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  maybeEncryptToken,
  encryptToken,
  decryptToken,
  isTokenEncryptionConfigured,
  tokenFingerprint,
} from "./token-cipher";

const KEY = Buffer.alloc(32, 7).toString("base64"); // deterministic 32-byte test key
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("token-cipher without a key (default / pre-go-live)", () => {
  beforeEach(() => {
    delete process.env.QBO_TOKEN_ENC_KEY;
  });
  it("reports encryption off and stores plaintext", () => {
    expect(isTokenEncryptionConfigured()).toBe(false);
    expect(maybeEncryptToken("tok_abc")).toBe("tok_abc");
  });
  it("passes a legacy plaintext value through on read", () => {
    expect(decryptToken("tok_abc")).toBe("tok_abc");
  });
  it("returns null for an encrypted value it has no key to read", () => {
    expect(decryptToken("qbov1:aa:bb:cc")).toBeNull();
  });
});

describe("token-cipher with a key", () => {
  beforeEach(() => {
    process.env.QBO_TOKEN_ENC_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.QBO_TOKEN_ENC_KEY;
  });

  it("configures on and round-trips a token", () => {
    expect(isTokenEncryptionConfigured()).toBe(true);
    const enc = maybeEncryptToken("secret-refresh-token");
    expect(enc.startsWith("qbov1:")).toBe(true);
    expect(enc).not.toContain("secret-refresh-token");
    expect(decryptToken(enc)).toBe("secret-refresh-token");
  });

  it("uses a fresh IV each time (same plaintext -> different ciphertext)", () => {
    const a = encryptToken("same");
    const b = encryptToken("same");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same");
    expect(decryptToken(b)).toBe("same");
  });

  it("still passes legacy plaintext through (mixed rows during migration)", () => {
    expect(decryptToken("legacy-plaintext")).toBe("legacy-plaintext");
  });

  it("returns null on tampered ciphertext (auth tag fails)", () => {
    const enc = encryptToken("hello");
    const parts = enc.split(":");
    // Flip the last base64 char of the ciphertext.
    const ct = parts[3]!;
    parts[3] = ct.slice(0, -1) + (ct.endsWith("A") ? "B" : "A");
    expect(decryptToken(parts.join(":"))).toBeNull();
  });

  it("returns null when decrypting with the wrong key", () => {
    const enc = encryptToken("hello");
    process.env.QBO_TOKEN_ENC_KEY = OTHER_KEY;
    expect(decryptToken(enc)).toBeNull();
  });

  it("disables encryption when the key isn't 32 bytes", () => {
    process.env.QBO_TOKEN_ENC_KEY = "too-short";
    expect(isTokenEncryptionConfigured()).toBe(false);
    expect(maybeEncryptToken("x")).toBe("x");
  });

  it("accepts a hex-encoded key too", () => {
    process.env.QBO_TOKEN_ENC_KEY = Buffer.alloc(32, 3).toString("hex");
    const enc = encryptToken("hex-key-token");
    expect(decryptToken(enc)).toBe("hex-key-token");
  });
});

describe("tokenFingerprint", () => {
  it("is a deterministic sha256 hex of the plaintext (matches Postgres backfill)", () => {
    const fp = tokenFingerprint("refresh-xyz");
    expect(fp).toBe(
      createHash("sha256").update("refresh-xyz", "utf8").digest("hex"),
    );
    expect(tokenFingerprint("refresh-xyz")).toBe(fp); // stable
    expect(tokenFingerprint("other")).not.toBe(fp);
  });
});
