import { describe, it, expect } from "vitest";
import { summarize, type ProviderHealth } from "./health";

const p = (
  provider: "openai" | "anthropic",
  ok: boolean,
  primary: boolean,
): ProviderHealth => ({
  provider,
  ok,
  error: ok ? null : "429 You exceeded your current quota",
  primary,
  ms: 10,
});

describe("AI health summary", () => {
  it("is healthy when the primary answers", () => {
    expect(summarize([p("openai", true, true), p("anthropic", true, false)]))
      .toEqual({ healthy: true, degraded: false });
  });

  // The 2026-07-30 shape, once failover exists: documents still get read, but
  // by the parachute. Someone needs to know before the parachute goes too.
  it("is DEGRADED when the primary is dead but the parachute answers", () => {
    expect(summarize([p("openai", false, true), p("anthropic", true, false)]))
      .toEqual({ healthy: true, degraded: true });
  });

  // The 2026-07-30 shape as it actually happened: nothing can read.
  it("is UNHEALTHY when every provider is down", () => {
    expect(summarize([p("openai", false, true), p("anthropic", false, false)]))
      .toEqual({ healthy: false, degraded: false });
  });

  it("is unhealthy, not degraded, when nothing is configured at all", () => {
    expect(summarize([])).toEqual({ healthy: false, degraded: false });
  });

  it("a lone healthy primary is not degraded", () => {
    expect(summarize([p("openai", true, true)])).toEqual({
      healthy: true,
      degraded: false,
    });
  });

  it("a lone dead primary is unhealthy", () => {
    expect(summarize([p("openai", false, true)])).toEqual({
      healthy: false,
      degraded: false,
    });
  });
});
