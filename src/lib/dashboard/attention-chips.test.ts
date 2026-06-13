import { describe, it, expect } from "vitest";
import {
  pickAttentionChips,
  type AttentionChipFacts,
} from "./attention-chips";

// Minimal row facts; override per case.
function facts(over: Partial<AttentionChipFacts> = {}): AttentionChipFacts {
  return {
    reasons: [],
    sittingUnreviewed: false,
    flaggedFilesCount: 0,
    signedCopiesToConfirm: 0,
    readyToReview: false,
    ...over,
  };
}

describe("pickAttentionChips", () => {
  it("returns nothing for a row with no signals", () => {
    expect(pickAttentionChips(facts())).toEqual({ accent: null, context: [] });
  });

  it("gives the single signal the accent when it is accent-capable", () => {
    expect(pickAttentionChips(facts({ readyToReview: true }))).toEqual({
      accent: "ready",
      context: [],
    });
    expect(pickAttentionChips(facts({ flaggedFilesCount: 2 }))).toEqual({
      accent: "flagged",
      context: [],
    });
  });

  it("follows the accent priority: overdue > ready > flagged > signed copy > due soon", () => {
    const all = facts({
      reasons: ["overdue", "due_soon"],
      readyToReview: true,
      flaggedFilesCount: 1,
      signedCopiesToConfirm: 1,
    });
    expect(pickAttentionChips(all).accent).toBe("overdue");

    const noOverdue = facts({
      reasons: ["due_soon"],
      readyToReview: true,
      flaggedFilesCount: 1,
      signedCopiesToConfirm: 1,
    });
    expect(pickAttentionChips(noOverdue).accent).toBe("ready");

    const noReady = facts({
      reasons: ["due_soon"],
      flaggedFilesCount: 1,
      signedCopiesToConfirm: 1,
    });
    expect(pickAttentionChips(noReady).accent).toBe("flagged");

    const signedVsDue = facts({
      reasons: ["due_soon"],
      signedCopiesToConfirm: 1,
    });
    expect(pickAttentionChips(signedVsDue).accent).toBe("signed_copy");

    expect(pickAttentionChips(facts({ reasons: ["due_soon"] })).accent).toBe(
      "due_soon",
    );
  });

  it("never gives the accent to the passive signals (waiting / quiet)", () => {
    const passiveOnly = facts({
      reasons: ["stale"],
      sittingUnreviewed: true,
    });
    expect(pickAttentionChips(passiveOnly)).toEqual({
      accent: null,
      context: ["sitting"], // stale deduped away, see below
    });
  });

  it("drops Quiet when Waiting applies (waiting is always the older clock)", () => {
    const both = facts({
      reasons: ["stale"],
      sittingUnreviewed: true,
      flaggedFilesCount: 3,
    });
    const chips = pickAttentionChips(both);
    expect(chips.accent).toBe("flagged");
    expect(chips.context).toEqual(["sitting"]);
    expect(chips.context).not.toContain("stale");
  });

  it("keeps Quiet when nothing is sitting unreviewed", () => {
    expect(pickAttentionChips(facts({ reasons: ["stale"] }))).toEqual({
      accent: null,
      context: ["stale"],
    });
  });

  it("renders Waiting alone as context when it is the only signal", () => {
    expect(pickAttentionChips(facts({ sittingUnreviewed: true }))).toEqual({
      accent: null,
      context: ["sitting"],
    });
  });

  it("demotes every non-winning reason to context, in display order", () => {
    const loaded = facts({
      reasons: ["overdue", "due_soon"],
      sittingUnreviewed: true,
      flaggedFilesCount: 1,
      signedCopiesToConfirm: 1,
      readyToReview: true,
    });
    expect(pickAttentionChips(loaded)).toEqual({
      accent: "overdue",
      context: ["sitting", "flagged", "signed_copy", "ready", "due_soon"],
    });
  });

  // The founder's screenshot rows, as regression anchors.
  it("matches the brief's examples (one colored chip per row)", () => {
    // "Waiting 25 days · 3 flagged files · Quiet for 8 days"
    expect(
      pickAttentionChips(
        facts({
          reasons: ["stale"],
          sittingUnreviewed: true,
          flaggedFilesCount: 3,
        }),
      ),
    ).toEqual({ accent: "flagged", context: ["sitting"] });

    // "3 flagged files · Due in 4 days"
    expect(
      pickAttentionChips(
        facts({ reasons: ["due_soon"], flaggedFilesCount: 3 }),
      ),
    ).toEqual({ accent: "flagged", context: ["due_soon"] });
  });
});
