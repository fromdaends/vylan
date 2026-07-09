import { describe, it, expect } from "vitest";
import { isConfirmedVerdict, isVerdictSettled } from "./route";

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

// The green "received — looks like the right document" note. Conservative by
// design: only an explicit looks_correct=true read confirms; everything
// ambiguous stays silent (the accountant review covers it).
describe("isConfirmedVerdict", () => {
  const fields = (looks: unknown) => ({ looks_correct: looks });

  it("confirms a usable, correct-looking upload", () => {
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: fields(true),
        ai_usability: { usable: true },
        ai_rejected: false,
      }),
    ).toBe(true);
  });

  it("never confirms a rejected file, even if fields say correct", () => {
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: fields(true),
        ai_usability: { usable: true },
        ai_rejected: true,
      }),
    ).toBe(false);
  });

  it("never confirms an unusable document", () => {
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: fields(true),
        ai_usability: { usable: false },
        ai_rejected: false,
      }),
    ).toBe(false);
  });

  it("stays silent when looks_correct is false, missing, or garbled", () => {
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: fields(false),
        ai_usability: { usable: true },
        ai_rejected: false,
      }),
    ).toBe(false);
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: {},
        ai_usability: { usable: true },
        ai_rejected: false,
      }),
    ).toBe(false);
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: null,
        ai_usability: null,
        ai_rejected: false,
      }),
    ).toBe(false);
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: fields("true"),
        ai_usability: { usable: true },
        ai_rejected: false,
      }),
    ).toBe(false);
  });

  it("treats unknown usability as usable (confirmation still allowed)", () => {
    // usability missing but the classifier read looks_correct=true — e.g. an
    // older row shape. The explicit positive read is the signal that matters.
    expect(
      isConfirmedVerdict({
        ai_extracted_fields: fields(true),
        ai_usability: {},
        ai_rejected: false,
      }),
    ).toBe(true);
  });
});
