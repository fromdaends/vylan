import { describe, it, expect } from "vitest";
import { engagementLetterKey } from "./letter-key";

describe("engagementLetterKey", () => {
  it("prefers the tax year over the creation year", () => {
    expect(
      engagementLetterKey({
        type: "t1",
        taxYear: 2025,
        createdAt: "2026-03-01T00:00:00Z",
      }),
    ).toBe("t1:2025");
  });

  it("falls back to the creation year so recurring work dedupes", () => {
    // The case that matters: twelve bookkeeping occurrences in one year must
    // share a key, or the client signs the same letter every month.
    const jan = engagementLetterKey({
      type: "bookkeeping",
      taxYear: null,
      createdAt: "2026-01-31T00:00:00Z",
    });
    const dec = engagementLetterKey({
      type: "bookkeeping",
      taxYear: null,
      createdAt: "2026-12-31T00:00:00Z",
    });
    expect(jan).toBe("bookkeeping:2026");
    expect(dec).toBe(jan);
  });

  it("starts a fresh key each calendar year", () => {
    expect(
      engagementLetterKey({ type: "bookkeeping", createdAt: "2027-01-01T00:00:00Z" }),
    ).toBe("bookkeeping:2027");
  });

  it("normalizes an unknown or missing type to custom", () => {
    for (const t of [null, undefined, "", "T1", "payroll", 7 as unknown as string]) {
      expect(
        engagementLetterKey({ type: t, taxYear: 2025 }),
      ).toBe("custom:2025");
    }
  });

  it("keeps different services in the same year apart", () => {
    expect(engagementLetterKey({ type: "t1", taxYear: 2025 })).not.toBe(
      engagementLetterKey({ type: "bookkeeping", taxYear: 2025 }),
    );
  });

  it("returns null when no year is knowable — never dedupe on a guess", () => {
    expect(engagementLetterKey({ type: "t1" })).toBeNull();
    expect(engagementLetterKey({ type: "t1", createdAt: "not a date" })).toBeNull();
    expect(engagementLetterKey({ type: "t1", taxYear: Number.NaN })).toBeNull();
  });
});
