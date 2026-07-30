import { describe, it, expect } from "vitest";
import { assessHealth, overallLevel, type HealthFacts } from "./verdict";

const NOW = new Date("2026-07-30T12:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

function facts(over: Partial<HealthFacts> = {}): HealthFacts {
  return {
    ai: {
      provider: "openai",
      providerChosen: true,
      keyPresent: true,
      recent: { considered: 10, read: 10, lastReadAt: hoursAgo(2) },
    },
    migrations: [
      { file: "1050_x.sql", feature: "sales tax direction", applied: true },
    ],
    connections: [],
    jobs: { failedRecently: 0, oldestPendingMinutes: null },
    now: NOW,
    ...over,
  };
}

const find = (fs: ReturnType<typeof assessHealth>, id: string) =>
  fs.find((f) => f.id === id);

describe("assessHealth — document reading", () => {
  it("is quiet when everything works", () => {
    const fs = assessHealth(facts());
    expect(overallLevel(fs)).toBe("ok");
    expect(find(fs, "ai-reads")!.level).toBe("ok");
    // A passing check must not tell the founder to do anything.
    expect(find(fs, "ai-reads")!.action).toBeUndefined();
  });

  it("FAILS when the selected provider has no key, naming that provider", () => {
    const fs = assessHealth(
      facts({
        ai: {
          provider: "openai",
          providerChosen: true,
          keyPresent: false,
          recent: null,
        },
      }),
    );
    const f = find(fs, "ai-key")!;
    expect(f.level).toBe("fail");
    expect(f.summary).toContain("OpenAI");
    expect(f.action).toContain("OpenAI");
  });

  it("warns when the provider was DEFAULTED rather than chosen", () => {
    // The exact trap that made an eval score the wrong model for a whole day.
    const fs = assessHealth(
      facts({
        ai: {
          provider: "anthropic",
          providerChosen: false,
          keyPresent: true,
          recent: { considered: 5, read: 5, lastReadAt: hoursAgo(1) },
        },
      }),
    );
    expect(find(fs, "ai-provider-default")!.level).toBe("warn");
  });

  it("does not nag about the default when it was set explicitly", () => {
    expect(find(assessHealth(facts()), "ai-provider-default")).toBeUndefined();
  });

  it("FAILS when a key exists but nothing is being read — the empty-balance case", () => {
    // A present key proves nothing: an exhausted balance looks identical from
    // the outside, which is exactly how this went unnoticed.
    const fs = assessHealth(
      facts({
        ai: {
          provider: "openai",
          providerChosen: true,
          keyPresent: true,
          recent: { considered: 8, read: 0, lastReadAt: null },
        },
      }),
    );
    const f = find(fs, "ai-reads")!;
    expect(f.level).toBe("fail");
    expect(f.action).toContain("credit");
  });

  it("warns on a poor read rate without crying wolf on the odd bad photo", () => {
    const poor = assessHealth(
      facts({
        ai: {
          provider: "openai",
          providerChosen: true,
          keyPresent: true,
          recent: { considered: 10, read: 3, lastReadAt: hoursAgo(5) },
        },
      }),
    );
    expect(find(poor, "ai-reads")!.level).toBe("warn");

    const fine = assessHealth(
      facts({
        ai: {
          provider: "openai",
          providerChosen: true,
          keyPresent: true,
          recent: { considered: 10, read: 8, lastReadAt: hoursAgo(5) },
        },
      }),
    );
    expect(find(fine, "ai-reads")!.level).toBe("ok");
  });

  it("says nothing about reads when there is nothing to judge by", () => {
    const fs = assessHealth(facts({ ai: { ...facts().ai, recent: null } }));
    expect(find(fs, "ai-reads")).toBeUndefined();
  });
});

describe("assessHealth — unapplied migrations", () => {
  it("FAILS and names the files to run", () => {
    const fs = assessHealth(
      facts({
        migrations: [
          { file: "1040_a.sql", feature: "posting history", applied: false },
          { file: "1060_b.sql", feature: "currency", applied: false },
          { file: "1050_c.sql", feature: "tax direction", applied: true },
        ],
      }),
    );
    const f = find(fs, "migrations")!;
    expect(f.level).toBe("fail");
    expect(f.summary).toContain("posting history");
    expect(f.summary).toContain("currency");
    // The whole point is that it tells you what to run.
    expect(f.action).toContain("1040_a.sql");
    expect(f.action).toContain("1060_b.sql");
    expect(f.action).not.toContain("1050_c.sql");
  });

  it("uses singular wording for exactly one", () => {
    const fs = assessHealth(
      facts({
        migrations: [{ file: "1040.sql", feature: "posting history", applied: false }],
      }),
    );
    expect(find(fs, "migrations")!.summary).toContain("A database update");
  });
});

describe("assessHealth — connections that are connected but not usable", () => {
  const conn = (over: Partial<HealthFacts["connections"][0]> = {}) => ({
    clientName: "ABC Inc",
    provider: "xero" as const,
    lastSyncedAt: hoursAgo(3),
    booksCurrencyKnown: true,
    ...over,
  });

  it("FAILS when the lists never loaded — connected but nothing can match", () => {
    const fs = assessHealth(facts({ connections: [conn({ lastSyncedAt: null })] }));
    const f = find(fs, "sync-ABC Inc")!;
    expect(f.level).toBe("fail");
    expect(f.summary).toContain("never loaded");
  });

  it("warns on a stale cache, because new suppliers go missing silently", () => {
    const fs = assessHealth(
      facts({ connections: [conn({ lastSyncedAt: daysAgo(30) })] }),
    );
    expect(find(fs, "sync-ABC Inc")!.level).toBe("warn");
  });

  it("stays quiet on a recent sync", () => {
    const fs = assessHealth(facts({ connections: [conn()] }));
    expect(find(fs, "sync-ABC Inc")).toBeUndefined();
  });

  it("warns when the books' currency is unknown", () => {
    const fs = assessHealth(
      facts({ connections: [conn({ booksCurrencyKnown: false })] }),
    );
    expect(find(fs, "currency-ABC Inc")!.level).toBe("warn");
  });

  it("names the right product per client", () => {
    const fs = assessHealth(
      facts({
        connections: [
          conn({ clientName: "Q Ltd", provider: "quickbooks", lastSyncedAt: null }),
        ],
      }),
    );
    expect(find(fs, "sync-Q Ltd")!.summary).toContain("QuickBooks");
  });
});

describe("assessHealth — background work", () => {
  it("warns about recent failures", () => {
    const fs = assessHealth(
      facts({ jobs: { failedRecently: 3, oldestPendingMinutes: null } }),
    );
    expect(find(fs, "jobs-failed")!.level).toBe("warn");
  });

  it("warns about a stuck task but not a merely busy one", () => {
    expect(
      find(
        assessHealth(facts({ jobs: { failedRecently: 0, oldestPendingMinutes: 240 } })),
        "jobs-stuck",
      )!.level,
    ).toBe("warn");
    expect(
      find(
        assessHealth(facts({ jobs: { failedRecently: 0, oldestPendingMinutes: 5 } })),
        "jobs-stuck",
      ),
    ).toBeUndefined();
  });
});

describe("overallLevel", () => {
  it("reports the worst thing found", () => {
    expect(overallLevel([{ id: "a", level: "ok", summary: "" }])).toBe("ok");
    expect(
      overallLevel([
        { id: "a", level: "ok", summary: "" },
        { id: "b", level: "warn", summary: "" },
      ]),
    ).toBe("warn");
    expect(
      overallLevel([
        { id: "a", level: "warn", summary: "" },
        { id: "b", level: "fail", summary: "" },
      ]),
    ).toBe("fail");
  });

  it("is ok when nothing was checked", () => {
    expect(overallLevel([])).toBe("ok");
  });
});
