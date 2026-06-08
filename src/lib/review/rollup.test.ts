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
});
