import { describe, it, expect } from "vitest";
import { isPortalFileAccessAllowed } from "./file-access";

const FUTURE = "2999-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";
const NOW = new Date("2026-06-08T00:00:00Z");

type Input = Parameters<typeof isPortalFileAccessAllowed>[0];

// Base case = a valid token reading a file in its own, live engagement.
function check(over: Partial<Input> = {}): boolean {
  return isPortalFileAccessAllowed({
    tokenShapeValid: true,
    engagement: { id: "eng-1", status: "in_progress", magic_expires_at: FUTURE },
    file: { engagement_id: "eng-1" },
    now: NOW,
    ...over,
  });
}

describe("isPortalFileAccessAllowed", () => {
  it("allows a valid token reading a file in its own engagement", () => {
    expect(check()).toBe(true);
  });

  it("allows when the magic link has no expiry set", () => {
    expect(
      check({
        engagement: {
          id: "eng-1",
          status: "in_progress",
          magic_expires_at: null,
        },
      }),
    ).toBe(true);
  });

  it("allows viewing a completed (non-cancelled) engagement", () => {
    expect(
      check({
        engagement: {
          id: "eng-1",
          status: "complete",
          magic_expires_at: FUTURE,
        },
      }),
    ).toBe(true);
  });

  it("rejects a malformed token without trusting any row", () => {
    expect(check({ tokenShapeValid: false })).toBe(false);
  });

  it("rejects when no engagement matched the token", () => {
    expect(check({ engagement: null })).toBe(false);
  });

  it("rejects a cancelled engagement (portal revoked)", () => {
    expect(
      check({
        engagement: {
          id: "eng-1",
          status: "cancelled",
          magic_expires_at: FUTURE,
        },
      }),
    ).toBe(false);
  });

  it("rejects an expired magic link", () => {
    expect(
      check({
        engagement: {
          id: "eng-1",
          status: "in_progress",
          magic_expires_at: PAST,
        },
      }),
    ).toBe(false);
  });

  it("rejects when the requested file does not exist", () => {
    expect(check({ file: null })).toBe(false);
  });

  it("rejects a file that belongs to ANOTHER engagement (cross-client isolation)", () => {
    // The decisive guarantee: a valid token can never read another client's
    // documents by guessing a file id.
    expect(check({ file: { engagement_id: "eng-2" } })).toBe(false);
  });
});
