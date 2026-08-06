import { describe, it, expect } from "vitest";
import { statusTone } from "./status-tone";

// The board's pills are DERIVED from what the workflow engine knows — the rule
// left for this session by the engine's author, because a hand-set status
// "lies within a week". These tests pin the derivation, not the colours' taste.

describe("statusTone", () => {
  it("makes In progress ACCENT — the blue the design shows", () => {
    // The founder, looking at the built board: "in progress doesn't have the
    // blue highlight like the design has it."
    expect(statusTone("in_progress")).toBe("accent");
  });

  it("marks the two states that are somebody's turn", () => {
    // Yours: the engine is holding a gate open for you.
    expect(statusTone("ready_to_review")).toBe("success");
    // Theirs: sent and unaccepted, with the chase engine already acting.
    expect(statusTone("sent")).toBe("warning");
  });

  it("keeps inert states quiet", () => {
    // Colour marks the exception. A draft is not an exception.
    expect(statusTone("draft")).toBe("muted");
  });

  it("uses the damage colour only for damage", () => {
    expect(statusTone("cancelled")).toBe("destructive");
    // Done is success, NOT destructive — the two must never be confusable.
    expect(statusTone("complete")).toBe("success");
  });

  it("falls back to accent for anything new rather than throwing", () => {
    // A status added later renders as ordinary active work — wrong-ish, but
    // visible. Throwing would blank the whole board over one unknown row.
    expect(statusTone("some_future_status")).toBe("accent");
  });
});
