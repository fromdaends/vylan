import { describe, it, expect } from "vitest";
import { isVerdictSettled } from "./route";

// firmAutoRejectOn toggles whether the router will write an auto-reject banner
// we must wait for. Most cases below pin it explicitly.
describe("isVerdictSettled", () => {
  it("is pending before the classifier has written anything", () => {
    expect(
      isVerdictSettled(
        { ai_classification: null, ai_usability: null, ai_rejected: false },
        false,
      ),
    ).toBe(false);
  });

  it("is settled once a usable classification landed and the router won't act", () => {
    expect(
      isVerdictSettled(
        {
          ai_classification: "t4",
          ai_usability: { usable: true, confidence: 0.95 },
          ai_rejected: false,
        },
        true,
      ),
    ).toBe(true);
  });

  it("keeps polling in the one window where the router will still auto-reject", () => {
    // unusable + confident + firm auto-reject ON, but ai_rejected not set yet:
    // the router is about to write the banner — don't declare done early.
    expect(
      isVerdictSettled(
        {
          ai_classification: "other",
          ai_usability: { usable: false, confidence: 0.9 },
          ai_rejected: false,
        },
        true,
      ),
    ).toBe(false);
  });

  it("settles once that pending auto-reject actually lands", () => {
    expect(
      isVerdictSettled(
        {
          ai_classification: "other",
          ai_usability: { usable: false, confidence: 0.9 },
          ai_rejected: true,
        },
        true,
      ),
    ).toBe(true);
  });

  it("does not wait on the router when the firm has auto-reject OFF", () => {
    expect(
      isVerdictSettled(
        {
          ai_classification: "other",
          ai_usability: { usable: false, confidence: 0.9 },
          ai_rejected: false,
        },
        false,
      ),
    ).toBe(true);
  });

  it("does not wait on the router for a low-confidence unusable read", () => {
    expect(
      isVerdictSettled(
        {
          ai_classification: "other",
          ai_usability: { usable: false, confidence: 0.5 },
          ai_rejected: false,
        },
        true,
      ),
    ).toBe(true);
  });

  // The bug this fix targets: a malformed AI read leaves BOTH columns null but
  // the router still flipped ai_rejected=true. Previously aiRan was false, so
  // the client polled for the full 10 minutes and never resolved.
  it("settles a rejected file even when classification AND usability are null", () => {
    expect(
      isVerdictSettled(
        { ai_classification: null, ai_usability: null, ai_rejected: true },
        true,
      ),
    ).toBe(true);
    expect(
      isVerdictSettled(
        { ai_classification: null, ai_usability: null, ai_rejected: true },
        false,
      ),
    ).toBe(true);
  });
});
