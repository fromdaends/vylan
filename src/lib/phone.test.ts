import { describe, expect, it } from "vitest";
import { normalizeToE164 } from "./phone";

describe("normalizeToE164", () => {
  it("normalizes bare 10-digit Canadian numbers to +1", () => {
    expect(normalizeToE164("5145551234")).toBe("+15145551234");
    expect(normalizeToE164("514-555-1234")).toBe("+15145551234");
    expect(normalizeToE164("(514) 555-1234")).toBe("+15145551234");
    expect(normalizeToE164("514 555 1234")).toBe("+15145551234");
    expect(normalizeToE164("514.555.1234")).toBe("+15145551234");
  });

  it("normalizes 11-digit numbers with a leading 1", () => {
    expect(normalizeToE164("15145551234")).toBe("+15145551234");
    expect(normalizeToE164("1 514 555 1234")).toBe("+15145551234");
    expect(normalizeToE164("1-514-555-1234")).toBe("+15145551234");
  });

  it("passes through already-international numbers", () => {
    expect(normalizeToE164("+15145551234")).toBe("+15145551234");
    expect(normalizeToE164("+1 514 555 1234")).toBe("+15145551234");
    expect(normalizeToE164("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normalizeToE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects NANP numbers whose area code or exchange starts with 0/1", () => {
    expect(normalizeToE164("0145551234")).toBeNull();
    expect(normalizeToE164("1145551234")).toBeNull();
    expect(normalizeToE164("5141551234")).toBeNull();
    expect(normalizeToE164("+10145551234")).toBeNull();
  });

  it("rejects +1 numbers that are not exactly 11 digits", () => {
    expect(normalizeToE164("+1514555123")).toBeNull();
    expect(normalizeToE164("+151455512345")).toBeNull();
  });

  it("rejects international numbers outside E.164 length bounds", () => {
    expect(normalizeToE164("+331234")).toBeNull();
    expect(normalizeToE164("+3361234567890123456")).toBeNull();
  });

  it("rejects garbage, extensions, and empty input", () => {
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("   ")).toBeNull();
    expect(normalizeToE164("abc")).toBeNull();
    expect(normalizeToE164("12345")).toBeNull();
    expect(normalizeToE164("514-555-1234 ext 22")).toBeNull();
    expect(normalizeToE164("0033 6 12 34 56 78")).toBeNull();
  });
});
