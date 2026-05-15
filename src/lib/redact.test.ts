import { describe, it, expect } from "vitest";
import { redactEmail, redactPhone } from "./redact";

describe("redactEmail", () => {
  it("shows first letter + domain", () => {
    expect(redactEmail("jean.tremblay@example.com")).toBe("j***@example.com");
  });

  it("handles single-letter local parts", () => {
    expect(redactEmail("a@example.com")).toBe("a***@example.com");
  });

  it("falls back to *** for malformed inputs", () => {
    expect(redactEmail("not-an-email")).toBe("***");
    expect(redactEmail("@example.com")).toBe("***");
    expect(redactEmail("")).toBe("***");
  });

  it("trims whitespace before redacting", () => {
    expect(redactEmail("  jean@example.com  ")).toBe("j***@example.com");
  });
});

describe("redactPhone", () => {
  it("keeps only the last 4 digits of a North-American number", () => {
    expect(redactPhone("+15145551234")).toBe("+***-***-1234");
  });

  it("strips formatting characters", () => {
    expect(redactPhone("(514) 555-1234")).toBe("+***-***-1234");
    expect(redactPhone("514.555.1234")).toBe("+***-***-1234");
  });

  it("works for international numbers", () => {
    expect(redactPhone("+33612345678")).toBe("+***-***-5678");
  });

  it("falls back to *** for inputs with fewer than 4 digits", () => {
    expect(redactPhone("123")).toBe("***");
    expect(redactPhone("")).toBe("***");
  });
});
