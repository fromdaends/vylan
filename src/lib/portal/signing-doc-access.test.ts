import { describe, it, expect } from "vitest";
import { isSigningDocAccessAllowed } from "./signing-doc-access";

const FUTURE = "2999-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";
const NOW = new Date("2026-06-08T00:00:00Z");

type Input = Parameters<typeof isSigningDocAccessAllowed>[0];

// Base case = a valid token reading the document-to-sign of a signature item in
// its own, live engagement.
function check(over: Partial<Input> = {}): boolean {
  return isSigningDocAccessAllowed({
    tokenShapeValid: true,
    engagement: { id: "eng-1", status: "in_progress", magic_expires_at: FUTURE },
    item: {
      engagement_id: "eng-1",
      kind: "signature",
      signing_doc_path: "firms/f1/engagements/eng-1/signing/abc-doc.pdf",
    },
    now: NOW,
    ...over,
  });
}

describe("isSigningDocAccessAllowed", () => {
  it("allows a valid token reading a signature doc in its own engagement", () => {
    expect(check()).toBe(true);
  });

  it("allows when the magic link has no expiry set", () => {
    expect(
      check({
        engagement: { id: "eng-1", status: "in_progress", magic_expires_at: null },
      }),
    ).toBe(true);
  });

  it("allows on a completed (non-cancelled) engagement", () => {
    expect(
      check({
        engagement: { id: "eng-1", status: "complete", magic_expires_at: FUTURE },
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
        engagement: { id: "eng-1", status: "cancelled", magic_expires_at: FUTURE },
      }),
    ).toBe(false);
  });

  it("rejects an expired magic link", () => {
    expect(
      check({
        engagement: { id: "eng-1", status: "in_progress", magic_expires_at: PAST },
      }),
    ).toBe(false);
  });

  it("rejects when the requested item does not exist", () => {
    expect(check({ item: null })).toBe(false);
  });

  it("rejects an item that belongs to ANOTHER engagement (cross-client isolation)", () => {
    // The decisive guarantee: a valid token can never read another client's
    // document-to-sign by guessing an item id.
    expect(
      check({
        item: {
          engagement_id: "eng-2",
          kind: "signature",
          signing_doc_path: "firms/f9/engagements/eng-2/signing/x.pdf",
        },
      }),
    ).toBe(false);
  });

  it("rejects a COLLECTION item (no document-to-sign exists)", () => {
    // A normal document-collection item has no signing doc; serving its (null)
    // path or treating it as signable must be a 404.
    expect(
      check({
        item: {
          engagement_id: "eng-1",
          kind: "collection",
          signing_doc_path: null,
        },
      }),
    ).toBe(false);
  });

  it("rejects a signature item whose document was never stored (null path)", () => {
    expect(
      check({
        item: {
          engagement_id: "eng-1",
          kind: "signature",
          signing_doc_path: null,
        },
      }),
    ).toBe(false);
  });

  it("rejects a signature item with a blank/whitespace path", () => {
    expect(
      check({
        item: {
          engagement_id: "eng-1",
          kind: "signature",
          signing_doc_path: "   ",
        },
      }),
    ).toBe(false);
  });
});
