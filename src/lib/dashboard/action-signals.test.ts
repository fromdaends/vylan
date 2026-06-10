import { describe, it, expect } from "vitest";
import {
  computeActionSignals,
  SITTING_UNREVIEWED_DAYS,
  type SignalFile,
} from "./action-signals";

const NOW = new Date("2026-06-09T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

function file(overrides: Partial<SignalFile> = {}): SignalFile {
  return {
    request_item_id: "i1",
    uploaded_at: daysAgo(1),
    review_status: "pending",
    ai_rejected: false,
    ai_usability: null,
    is_duplicate: false,
    reviewed_by: null,
    ...overrides,
  };
}

const collectionItem = { id: "i1", kind: "collection" as const };
const signatureItem = { id: "sig1", kind: "signature" as const };

describe("computeActionSignals: flagged files", () => {
  it("counts pending files the AI flagged as unusable", () => {
    const r = computeActionSignals(
      [
        file({
          ai_usability: { usable: false } as SignalFile["ai_usability"],
        }),
        file(), // clean pending — not flagged
      ],
      [collectionItem],
      NOW,
    );
    expect(r.flaggedFiles).toBe(1);
  });

  it("counts escalated files (ai_rejected, still pending review)", () => {
    const r = computeActionSignals(
      [file({ ai_rejected: true })],
      [collectionItem],
      NOW,
    );
    expect(r.flaggedFiles).toBe(1);
  });

  it("counts an OUTSTANDING auto-reject (system bounce, no replacement yet)", () => {
    const r = computeActionSignals(
      [file({ ai_rejected: true, review_status: "rejected" })],
      [collectionItem],
      NOW,
    );
    expect(r.flaggedFiles).toBe(1);
  });

  it("does NOT count an auto-reject the client already replaced", () => {
    const r = computeActionSignals(
      [
        file({
          ai_rejected: true,
          review_status: "rejected",
          uploaded_at: daysAgo(5),
        }),
        // Newer clean upload on the same item supersedes the bounce.
        file({ uploaded_at: daysAgo(1), review_status: "approved" }),
      ],
      [collectionItem],
      NOW,
    );
    expect(r.flaggedFiles).toBe(0);
  });

  it("does NOT count rejections an accountant made themselves", () => {
    const r = computeActionSignals(
      [
        file({
          review_status: "rejected",
          ai_rejected: true,
          reviewed_by: "user-1", // the accountant weighed in — call made
        }),
      ],
      [collectionItem],
      NOW,
    );
    expect(r.flaggedFiles).toBe(0);
  });

  it("ignores duplicates entirely", () => {
    const r = computeActionSignals(
      [file({ ai_rejected: true, is_duplicate: true })],
      [collectionItem],
      NOW,
    );
    expect(r.flaggedFiles).toBe(0);
  });
});

describe("computeActionSignals: signed copies to confirm", () => {
  it("counts a signature item whose returned copy awaits confirmation", () => {
    const r = computeActionSignals(
      [file({ request_item_id: "sig1" })],
      [collectionItem, signatureItem],
      NOW,
    );
    expect(r.signedCopiesToConfirm).toBe(1);
  });

  it("one item counts once even with several pending files", () => {
    const r = computeActionSignals(
      [
        file({ request_item_id: "sig1", uploaded_at: daysAgo(2) }),
        file({ request_item_id: "sig1", uploaded_at: daysAgo(1) }),
      ],
      [signatureItem],
      NOW,
    );
    expect(r.signedCopiesToConfirm).toBe(1);
  });

  it("a confirmed signed copy no longer counts", () => {
    const r = computeActionSignals(
      [file({ request_item_id: "sig1", review_status: "approved" })],
      [signatureItem],
      NOW,
    );
    expect(r.signedCopiesToConfirm).toBe(0);
  });
});

describe("computeActionSignals: sitting unreviewed", () => {
  it("raises after more than the threshold days", () => {
    const r = computeActionSignals(
      [file({ uploaded_at: daysAgo(SITTING_UNREVIEWED_DAYS + 1) })],
      [collectionItem],
      NOW,
    );
    expect(r.sittingUnreviewed).toBe(true);
    expect(r.waitingDays).toBe(SITTING_UNREVIEWED_DAYS + 1);
  });

  it("stays quiet at exactly the threshold", () => {
    const r = computeActionSignals(
      [file({ uploaded_at: daysAgo(SITTING_UNREVIEWED_DAYS) })],
      [collectionItem],
      NOW,
    );
    expect(r.sittingUnreviewed).toBe(false);
  });

  it("tracks the OLDEST undecided upload", () => {
    const r = computeActionSignals(
      [
        file({ uploaded_at: daysAgo(6) }),
        file({ uploaded_at: daysAgo(1) }),
      ],
      [collectionItem],
      NOW,
    );
    expect(r.waitingSince).toBe(daysAgo(6));
    expect(r.waitingDays).toBe(6);
  });

  it("decided files do not wait", () => {
    const r = computeActionSignals(
      [
        file({ uploaded_at: daysAgo(10), review_status: "approved" }),
        file({ uploaded_at: daysAgo(10), review_status: "rejected" }),
      ],
      [collectionItem],
      NOW,
    );
    expect(r.waitingSince).toBeNull();
    expect(r.sittingUnreviewed).toBe(false);
  });
});
