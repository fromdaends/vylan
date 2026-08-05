import { describe, it, expect } from "vitest";
import { engagementLetterKey } from "./letter-key";

const SVC = "1488f973-2b15-46cf-a1d5-119625c541e3";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("engagementLetterKey", () => {
  it("prefers the tax year over the creation year", () => {
    expect(
      engagementLetterKey({
        serviceId: SVC,
        taxYear: 2025,
        createdAt: "2026-03-01T00:00:00Z",
      }),
    ).toBe(`svc:${SVC}:2025`);
  });

  it("falls back to the creation year so recurring work dedupes", () => {
    // The case that matters: twelve bookkeeping occurrences in one year must
    // share a key, or the client signs the same letter every month.
    const jan = engagementLetterKey({
      serviceId: SVC,
      taxYear: null,
      createdAt: "2026-01-31T00:00:00Z",
    });
    const dec = engagementLetterKey({
      serviceId: SVC,
      taxYear: null,
      createdAt: "2026-12-31T00:00:00Z",
    });
    expect(jan).toBe(`svc:${SVC}:2026`);
    expect(dec).toBe(jan);
  });

  it("starts a fresh key each calendar year", () => {
    expect(
      engagementLetterKey({ serviceId: SVC, createdAt: "2027-01-01T00:00:00Z" }),
    ).toBe(`svc:${SVC}:2027`);
  });

  it("keeps different services in the same year apart", () => {
    // The whole point of 1700: bookkeeping terms and tax terms are different
    // agreements, so signing one must not suppress the other.
    expect(engagementLetterKey({ serviceId: SVC, taxYear: 2025 })).not.toBe(
      engagementLetterKey({ serviceId: OTHER, taxYear: 2025 }),
    );
  });

  it("returns null with no service — nothing to dedupe against", () => {
    for (const s of [null, undefined, "", "   "]) {
      expect(engagementLetterKey({ serviceId: s, taxYear: 2025 })).toBeNull();
    }
  });

  it("returns null when no year is knowable — never dedupe on a guess", () => {
    expect(engagementLetterKey({ serviceId: SVC })).toBeNull();
    expect(
      engagementLetterKey({ serviceId: SVC, createdAt: "not a date" }),
    ).toBeNull();
    expect(
      engagementLetterKey({ serviceId: SVC, taxYear: Number.NaN }),
    ).toBeNull();
  });
});
