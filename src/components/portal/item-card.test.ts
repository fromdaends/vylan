import { describe, it, expect } from "vitest";
import { pollIntervalFor, shouldAskForMissingPage } from "./item-card";
import type { SetAssessment } from "@/lib/ai/set-assessment";

// The verdict-poll schedule: fast while the AI usually answers (seconds),
// then backed off but STILL listening — the durable fallback is a cron that
// retries every 2 minutes, and the old hard 30s cutoff meant a slow verdict
// only appeared after a manual page reload.
describe("pollIntervalFor", () => {
  it("polls fast (1.5s) for the first 30 seconds", () => {
    expect(pollIntervalFor(0)).toBe(1_500);
    expect(pollIntervalFor(29_999)).toBe(1_500);
  });

  it("backs off to 5s until 2 minutes", () => {
    expect(pollIntervalFor(30_000)).toBe(5_000);
    expect(pollIntervalFor(119_999)).toBe(5_000);
  });

  it("slows to 15s until 10 minutes — covering several cron retries", () => {
    expect(pollIntervalFor(120_000)).toBe(15_000);
    expect(pollIntervalFor(599_999)).toBe(15_000);
  });

  it("gives up after 10 minutes (the email/SMS fallback takes over)", () => {
    expect(pollIntervalFor(600_000)).toBeNull();
    expect(pollIntervalFor(3_600_000)).toBeNull();
  });
});

// The missing-page ask is the only AI verdict the CLIENT ever reads, so a stale
// one is worse than none: it contradicts the card it sits on.
describe("shouldAskForMissingPage", () => {
  const incomplete = {
    outcome: "incomplete",
    needs_client: true,
    client_request_en: "Page 4 of 4 is missing. Could you please upload it?",
  } as unknown as SetAssessment;
  const complete = { outcome: "complete" } as unknown as SetAssessment;

  const ask = (over: Partial<Parameters<typeof shouldAskForMissingPage>[0]> = {}) =>
    shouldAskForMissingPage({
      autoRequestMissingPages: true,
      status: "submitted",
      assessment: incomplete,
      ...over,
    });

  it("asks when a page is genuinely missing and nobody has decided yet", () => {
    expect(ask()).toBe(true);
  });

  it("stays silent when the firm never opted in", () => {
    expect(ask({ autoRequestMissingPages: false })).toBe(false);
  });

  it("stays silent when there is no assessment, or the set is complete", () => {
    expect(ask({ assessment: null })).toBe(false);
    expect(ask({ assessment: undefined })).toBe(false);
    expect(ask({ assessment: complete })).toBe(false);
  });

  // The bug this function exists for. Seen on a real client portal: the
  // accountant approved the document anyway (the legitimate "I don't need page
  // 4" override), and the client was shown "Approved — all set, thank you!"
  // directly above "Page 4 of 4 is missing. Could you please upload it?".
  it("goes quiet once the accountant approves anyway — a human decision beats the AI's ask", () => {
    expect(ask({ status: "approved" })).toBe(false);
  });

  it("goes quiet once the client marks the item not applicable", () => {
    expect(ask({ status: "na" })).toBe(false);
  });

  it("still asks on a rejected item — it can be BOTH wrong and missing a page", () => {
    // Deliberately not gated on 'rejected': a file rejected for some other
    // reason can still be missing a page, and the client needs both asks.
    expect(ask({ status: "rejected" })).toBe(true);
  });

  it("still asks while the item is merely pending or submitted", () => {
    expect(ask({ status: "pending" })).toBe(true);
    expect(ask({ status: "submitted" })).toBe(true);
  });

  it("the firm setting wins over everything — off means the client never sees it", () => {
    // Belt and braces: the accountant handles it privately in this mode.
    expect(ask({ autoRequestMissingPages: false, status: "rejected" })).toBe(false);
  });
});
