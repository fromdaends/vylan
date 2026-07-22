import { describe, it, expect } from "vitest";
import {
  bucketStartMs,
  easternCivilToUtcMs,
  easternYmd,
  enumerateBuckets,
  resolveRange,
} from "./range";

// 2026-07-21T23:03:00Z is 2026-07-21 19:03 in Eastern (EDT, UTC-4).
const NOW = Date.parse("2026-07-21T23:03:00Z");

describe("easternCivilToUtcMs", () => {
  it("maps a winter (EST, UTC-5) midnight to 05:00 UTC", () => {
    expect(new Date(easternCivilToUtcMs(2026, 1, 1)).toISOString()).toBe(
      "2026-01-01T05:00:00.000Z",
    );
  });

  it("maps a summer (EDT, UTC-4) midnight to 04:00 UTC", () => {
    expect(new Date(easternCivilToUtcMs(2026, 7, 1)).toISOString()).toBe(
      "2026-07-01T04:00:00.000Z",
    );
  });
});

describe("easternYmd", () => {
  it("reads the Eastern civil date, not the UTC one", () => {
    // 2026-07-01T02:00Z is still 2026-06-30 in Eastern (22:00 EDT).
    expect(easternYmd(Date.parse("2026-07-01T02:00:00Z"))).toEqual({
      y: 2026,
      mo: 6,
      d: 30,
    });
  });
});

describe("resolveRange", () => {
  it("this_month starts at the 1st of the current Eastern month, daily buckets", () => {
    const r = resolveRange("this_month", NOW);
    expect(r.startIso).toBe("2026-07-01T04:00:00.000Z");
    expect(r.granularity).toBe("day");
    expect(r.endMs).toBe(NOW);
  });

  it("last_3_months starts two months back, monthly buckets", () => {
    const r = resolveRange("last_3_months", NOW);
    expect(r.startIso).toBe("2026-05-01T04:00:00.000Z");
    expect(r.granularity).toBe("month");
  });

  it("all_time has no lower bound, monthly buckets", () => {
    const r = resolveRange("all_time", NOW);
    expect(r.startMs).toBeNull();
    expect(r.startIso).toBeNull();
    expect(r.granularity).toBe("month");
  });
});

describe("bucketStartMs", () => {
  it("snaps to the start of the Eastern day", () => {
    // 2026-07-21T23:03Z → Eastern Jul 21 → day start 2026-07-21T04:00Z.
    expect(new Date(bucketStartMs(NOW, "day")).toISOString()).toBe(
      "2026-07-21T04:00:00.000Z",
    );
  });

  it("snaps to the start of the Eastern month", () => {
    expect(new Date(bucketStartMs(NOW, "month")).toISOString()).toBe(
      "2026-07-01T04:00:00.000Z",
    );
  });
});

describe("enumerateBuckets", () => {
  it("lists each Eastern day inclusive of both ends", () => {
    const from = Date.parse("2026-07-01T04:00:00Z");
    const to = Date.parse("2026-07-03T04:00:00Z");
    const days = enumerateBuckets(from, to, "day").map((ms) =>
      new Date(ms).toISOString(),
    );
    expect(days).toEqual([
      "2026-07-01T04:00:00.000Z",
      "2026-07-02T04:00:00.000Z",
      "2026-07-03T04:00:00.000Z",
    ]);
  });

  it("lists each Eastern month across a span", () => {
    const from = Date.parse("2026-05-01T04:00:00Z");
    const to = Date.parse("2026-07-15T12:00:00Z");
    const months = enumerateBuckets(from, to, "month").map((ms) =>
      new Date(ms).toISOString(),
    );
    expect(months).toEqual([
      "2026-05-01T04:00:00.000Z",
      "2026-06-01T04:00:00.000Z",
      "2026-07-01T04:00:00.000Z",
    ]);
  });
});
