import { describe, it, expect } from "vitest";
import { formatRunning } from "./running-clock";

describe("formatRunning", () => {
  it("shows minutes and seconds while a timer is live", () => {
    expect(formatRunning(1565)).toBe("26m 5s");
    expect(formatRunning(5)).toBe("0m 5s");
  });

  it("adds hours once it passes one", () => {
    expect(formatRunning(3600 + 26 * 60 + 5)).toBe("1h 26m 5s");
  });

  it("never renders a negative from clock skew", () => {
    // started_at can land a moment in the future against a client clock; a
    // timer reading "-3s" is worse than one reading zero.
    expect(formatRunning(-3)).toBe("0m 0s");
  });
});
