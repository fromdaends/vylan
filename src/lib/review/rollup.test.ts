import { describe, it, expect } from "vitest";
import { deriveItemStatus, type FileReview } from "./rollup";

function f(over: Partial<FileReview>): FileReview {
  return {
    review_status: "pending",
    uploaded_at: "2026-01-01T00:00:00Z",
    reviewed_at: null,
    ...over,
  };
}

describe("deriveItemStatus", () => {
  it("no files => pending (not started)", () => {
    expect(deriveItemStatus([])).toBe("pending");
  });

  it("only pending uploads => submitted (in review)", () => {
    expect(deriveItemStatus([f({}), f({})])).toBe("submitted");
  });

  it("an approved file with nothing rejected => approved (done)", () => {
    expect(
      deriveItemStatus([
        f({ review_status: "approved", reviewed_at: "2026-01-02T00:00:00Z" }),
      ]),
    ).toBe("approved");
  });

  it("an outstanding rejection => rejected (needs attention)", () => {
    expect(
      deriveItemStatus([
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-02T00:00:00Z",
        }),
      ]),
    ).toBe("rejected");
  });

  it("a rejection wins even over an approved sibling", () => {
    expect(
      deriveItemStatus([
        f({
          review_status: "approved",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-02T00:00:00Z",
        }),
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-03T00:00:00Z",
        }),
      ]),
    ).toBe("rejected");
  });

  it("a rejection ANSWERED by a newer upload => submitted (in review)", () => {
    expect(
      deriveItemStatus([
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-02T00:00:00Z",
        }),
        // the client re-uploaded after the rejection
        f({ review_status: "pending", uploaded_at: "2026-01-03T00:00:00Z" }),
      ]),
    ).toBe("submitted");
  });

  it("a replacement that was ALSO rejected => rejected again", () => {
    expect(
      deriveItemStatus([
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-02T00:00:00Z",
        }),
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-03T00:00:00Z",
          reviewed_at: "2026-01-04T00:00:00Z",
        }),
      ]),
    ).toBe("rejected");
  });

  it("a replacement that was approved => approved (done)", () => {
    expect(
      deriveItemStatus([
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-02T00:00:00Z",
        }),
        f({
          review_status: "approved",
          uploaded_at: "2026-01-03T00:00:00Z",
          reviewed_at: "2026-01-04T00:00:00Z",
        }),
      ]),
    ).toBe("approved");
  });

  it("a pending file uploaded BEFORE the rejection does NOT answer it", () => {
    // B predates A's rejection, so it is not a response to it.
    expect(
      deriveItemStatus([
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-05T00:00:00Z",
        }),
        f({ review_status: "pending", uploaded_at: "2026-01-02T00:00:00Z" }),
      ]),
    ).toBe("rejected");
  });

  it("ignores a duplicate — an approved item is NOT dragged to needs-attention by a rejected duplicate re-upload", () => {
    // The critical case: a byte-identical re-upload auto-rejected as a duplicate
    // must not flip the already-good item to "needs attention" (the original is
    // what counts).
    expect(
      deriveItemStatus([
        f({
          review_status: "approved",
          uploaded_at: "2026-01-01T00:00:00Z",
          reviewed_at: "2026-01-02T00:00:00Z",
        }),
        f({
          review_status: "rejected",
          uploaded_at: "2026-01-03T00:00:00Z",
          reviewed_at: "2026-01-03T00:00:00Z",
          is_duplicate: true,
        }),
      ]),
    ).toBe("approved");
  });

  it("ignores a duplicate — a pending original + a pending duplicate stays submitted (the duplicate adds nothing)", () => {
    expect(
      deriveItemStatus([
        f({ review_status: "pending", uploaded_at: "2026-01-01T00:00:00Z" }),
        f({
          review_status: "pending",
          uploaded_at: "2026-01-02T00:00:00Z",
          is_duplicate: true,
        }),
      ]),
    ).toBe("submitted");
  });

  it("a lone duplicate (its original lives on another item) counts as no files => pending", () => {
    expect(deriveItemStatus([f({ is_duplicate: true })])).toBe("pending");
  });

  // Set-aware: a missing-page verdict keeps a would-be "submitted" item
  // "waiting on the client" (rejected-equivalent) until a newer upload answers.
  describe("set-aware missing-page override", () => {
    const SINCE = "2026-02-01T00:00:00Z";

    it("an outstanding missing-page set turns submitted into rejected", () => {
      expect(
        deriveItemStatus([f({ uploaded_at: "2026-01-15T00:00:00Z" })], {
          setNeedsClientSince: SINCE,
        }),
      ).toBe("rejected");
    });

    it("a newer upload after the assessment answers it (back to submitted)", () => {
      expect(
        deriveItemStatus([f({ uploaded_at: "2026-02-02T00:00:00Z" })], {
          setNeedsClientSince: SINCE,
        }),
      ).toBe("submitted");
    });

    it("never overrides an accountant's explicit approval", () => {
      expect(
        deriveItemStatus(
          [f({ review_status: "approved", uploaded_at: "2026-01-15T00:00:00Z" })],
          { setNeedsClientSince: SINCE },
        ),
      ).toBe("approved");
    });

    it("a real outstanding file rejection still wins", () => {
      expect(
        deriveItemStatus(
          [
            f({
              review_status: "rejected",
              uploaded_at: "2026-01-15T00:00:00Z",
              reviewed_at: "2026-01-16T00:00:00Z",
            }),
          ],
          { setNeedsClientSince: SINCE },
        ),
      ).toBe("rejected");
    });

    it("no override when the timestamp is null (default behaviour)", () => {
      expect(
        deriveItemStatus([f({})], { setNeedsClientSince: null }),
      ).toBe("submitted");
    });
  });
});
