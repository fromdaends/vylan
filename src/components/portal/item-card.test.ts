import { describe, it, expect } from "vitest";
import { pollIntervalFor } from "./item-card";

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
