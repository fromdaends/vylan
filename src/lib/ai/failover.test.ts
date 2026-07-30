import { describe, it, expect, vi, afterEach } from "vitest";
import {
  orderProviders,
  withProviderFailover,
  describeProviderError,
  type AiProvider,
} from "./failover";

// The incident this guards (2026-07-30): the OpenAI account's credit balance
// hit zero mid-demo, every read came back "429 You exceeded your current
// quota", and because the classifier was pinned to the one configured provider
// it retried the dead vendor five times and gave up. Anthropic was configured
// and healthy the entire time. Documents sat on "Reading…" forever.

const bothKeyed = () => true;
const onlyOpenAi = (p: AiProvider) => p === "openai";
const onlyAnthropic = (p: AiProvider) => p === "anthropic";
const noneKeyed = () => false;

afterEach(() => vi.restoreAllMocks());

describe("orderProviders", () => {
  it("puts the configured provider first, the other second", () => {
    expect(orderProviders("openai", bothKeyed)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(orderProviders("anthropic", bothKeyed)).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("drops a provider with no key rather than wasting a round trip", () => {
    expect(orderProviders("openai", onlyOpenAi)).toEqual(["openai"]);
    expect(orderProviders("openai", onlyAnthropic)).toEqual(["anthropic"]);
  });

  it("is empty when nothing is configured", () => {
    expect(orderProviders("openai", noneKeyed)).toEqual([]);
  });
});

describe("withProviderFailover", () => {
  it("uses the primary and never touches the parachute when it works", async () => {
    const seen: AiProvider[] = [];
    const out = await withProviderFailover(
      "classify",
      ["openai", "anthropic"],
      async (p) => {
        seen.push(p);
        return { ok: p };
      },
    );
    expect(out).toEqual({ ok: "openai" });
    expect(seen).toEqual(["openai"]);
  });

  // THE INCIDENT, exactly.
  it("fails over when the primary is out of quota", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: AiProvider[] = [];
    const out = await withProviderFailover(
      "classify",
      ["openai", "anthropic"],
      async (p) => {
        seen.push(p);
        if (p === "openai") {
          throw new Error(
            "429 You exceeded your current quota, please check your plan and billing details.",
          );
        }
        return { verdict: "read by anthropic" };
      },
    );
    expect(out).toEqual({ verdict: "read by anthropic" });
    expect(seen).toEqual(["openai", "anthropic"]);
  });

  it("fails over on an empty reply too, not just a throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: AiProvider[] = [];
    const out = await withProviderFailover(
      "classify",
      ["openai", "anthropic"],
      async (p) => {
        seen.push(p);
        return p === "openai" ? null : { verdict: "ok" };
      },
    );
    expect(out).toEqual({ verdict: "ok" });
    expect(seen).toEqual(["openai", "anthropic"]);
  });

  // Nothing is swallowed: a total outage must still surface as a hard failure
  // so the job retries and the error is recorded, rather than the file being
  // quietly marked "read" with nothing in it.
  it("rethrows the PRIMARY's error when every provider is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withProviderFailover("classify", ["openai", "anthropic"], async (p) => {
        throw new Error(p === "openai" ? "429 quota" : "529 overloaded");
      }),
    ).rejects.toThrow("429 quota");
  });

  it("returns null (not a throw) when every provider merely came back empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await withProviderFailover(
      "classify",
      ["openai", "anthropic"],
      async () => null,
    );
    expect(out).toBeNull();
  });

  it("does nothing at all with an empty chain", async () => {
    const attempt = vi.fn();
    expect(
      await withProviderFailover("classify", [], attempt),
    ).toBeNull();
    expect(attempt).not.toHaveBeenCalled();
  });

  it("keeps a single-provider deployment behaving exactly as before", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withProviderFailover("classify", ["openai"], async () => {
        throw new Error("429 quota");
      }),
    ).rejects.toThrow("429 quota");
  });
});

describe("describeProviderError", () => {
  it("keeps the vendor's message (that's what names the fix)", () => {
    expect(
      describeProviderError(new Error("429 You exceeded your current quota")),
    ).toContain("exceeded your current quota");
  });

  it("bounds the length so a log line can't carry a document", () => {
    expect(describeProviderError(new Error("x".repeat(5000))).length).toBe(300);
  });
});
