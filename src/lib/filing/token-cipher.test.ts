import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  decryptStorageToken,
  encryptStorageToken,
  isStorageTokenEncryptionConfigured,
  maybeEncryptStorageToken,
  storageTokenFingerprint,
} from "./token-cipher";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("storage token-cipher without a key", () => {
  beforeEach(() => {
    delete process.env.STORAGE_TOKEN_ENC_KEY;
  });
  it("reports encryption off and stores plaintext", () => {
    expect(isStorageTokenEncryptionConfigured()).toBe(false);
    expect(maybeEncryptStorageToken("tok_abc")).toBe("tok_abc");
  });
  it("passes a legacy plaintext value through on read", () => {
    expect(decryptStorageToken("tok_abc")).toBe("tok_abc");
  });
  it("returns null for an encrypted value it has no key to read", () => {
    expect(decryptStorageToken("stov1:aa:bb:cc")).toBeNull();
  });
});

describe("storage token-cipher with a key", () => {
  beforeEach(() => {
    process.env.STORAGE_TOKEN_ENC_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.STORAGE_TOKEN_ENC_KEY;
  });

  it("round-trips a token and marks it with the prefix", () => {
    expect(isStorageTokenEncryptionConfigured()).toBe(true);
    const enc = maybeEncryptStorageToken("secret-refresh-token");
    expect(enc.startsWith("stov1:")).toBe(true);
    expect(enc).not.toContain("secret-refresh-token");
    expect(decryptStorageToken(enc)).toBe("secret-refresh-token");
  });

  it("produces a different ciphertext every time (random IV)", () => {
    expect(encryptStorageToken("same")).not.toBe(encryptStorageToken("same"));
  });

  it("still reads legacy plaintext rows", () => {
    expect(decryptStorageToken("legacy-plain")).toBe("legacy-plain");
  });

  it("returns null on tamper or a rotated key", () => {
    const enc = encryptStorageToken("tok");
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(decryptStorageToken(tampered)).toBeNull();
    process.env.STORAGE_TOKEN_ENC_KEY = OTHER_KEY;
    expect(decryptStorageToken(enc)).toBeNull();
  });

  it("rejects a malformed key by falling back to plaintext mode", () => {
    process.env.STORAGE_TOKEN_ENC_KEY = "not-a-key";
    expect(isStorageTokenEncryptionConfigured()).toBe(false);
    expect(maybeEncryptStorageToken("tok")).toBe("tok");
  });

  it("fingerprint is deterministic and key-independent", () => {
    const a = storageTokenFingerprint("refresh-1");
    process.env.STORAGE_TOKEN_ENC_KEY = OTHER_KEY;
    expect(storageTokenFingerprint("refresh-1")).toBe(a);
    expect(storageTokenFingerprint("refresh-2")).not.toBe(a);
  });
});
