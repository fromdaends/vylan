import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  decryptPortalPin,
  encryptPortalPin,
  generatePinSalt,
  generatePortalPin,
  isPortalPinEncryptionConfigured,
  isValidPinShape,
  pinMatches,
} from "./pin-cipher";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("portal PIN cipher", () => {
  const original = process.env.PORTAL_PIN_ENC_KEY;
  beforeEach(() => {
    process.env.PORTAL_PIN_ENC_KEY = KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PORTAL_PIN_ENC_KEY;
    else process.env.PORTAL_PIN_ENC_KEY = original;
    vi.restoreAllMocks();
  });

  it("round-trips a PIN", () => {
    const pin = "042913";
    expect(decryptPortalPin(encryptPortalPin(pin))).toBe(pin);
  });

  it("keeps leading zeros — a PIN is a string, never a number", () => {
    const pin = "000042";
    const back = decryptPortalPin(encryptPortalPin(pin));
    expect(back).toBe("000042");
    expect(back).toHaveLength(6);
  });

  it("produces a different ciphertext every time (random IV)", () => {
    const a = encryptPortalPin("123456");
    const b = encryptPortalPin("123456");
    expect(a).not.toBe(b);
    expect(decryptPortalPin(a)).toBe(decryptPortalPin(b));
  });

  // THE ONE THAT MATTERS: unlike the storage/QBO ciphers this must never fall
  // back to writing a readable credential.
  it("FAILS CLOSED when the key is unset — throws, never stores plaintext", () => {
    delete process.env.PORTAL_PIN_ENC_KEY;
    expect(isPortalPinEncryptionConfigured()).toBe(false);
    expect(() => encryptPortalPin("123456")).toThrow();
  });

  it("refuses a malformed key rather than half-encrypting", () => {
    process.env.PORTAL_PIN_ENC_KEY = "too-short";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(isPortalPinEncryptionConfigured()).toBe(false);
    expect(() => encryptPortalPin("123456")).toThrow();
  });

  it("returns null when decrypting with a rotated key", () => {
    const stored = encryptPortalPin("123456");
    process.env.PORTAL_PIN_ENC_KEY = OTHER_KEY;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptPortalPin(stored)).toBeNull();
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const stored = encryptPortalPin("123456");
    const parts = stored.split(":");
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptPortalPin(parts.join(":"))).toBeNull();
  });

  it("treats an unprefixed value as invalid — this column was born encrypted", () => {
    expect(decryptPortalPin("123456")).toBeNull();
    expect(decryptPortalPin(null)).toBeNull();
  });

  it("generates six digits, and only digits", () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePortalPin();
      expect(pin).toMatch(/^[0-9]{6}$/);
      expect(isValidPinShape(pin)).toBe(true);
    }
  });

  it("rejects anything that is not exactly six digits", () => {
    for (const bad of ["12345", "1234567", "12345a", "", "  1234", "12 345"]) {
      expect(isValidPinShape(bad)).toBe(false);
    }
  });

  it("matches the right PIN and rejects wrong ones", () => {
    const stored = encryptPortalPin("246813");
    expect(pinMatches("246813", stored)).toBe(true);
    expect(pinMatches("246814", stored)).toBe(false);
    expect(pinMatches("24681", stored)).toBe(false);
    expect(pinMatches("2468133", stored)).toBe(false);
    expect(pinMatches("246813", null)).toBe(false);
  });

  it("gives every client a distinct salt", () => {
    const salts = new Set(Array.from({ length: 50 }, () => generatePinSalt()));
    expect(salts.size).toBe(50);
  });
});
