import { describe, it, expect } from "vitest";
import {
  FILTERABLE_STAGES,
  countByStage,
  filterRowsByStage,
  nextStageSort,
  parseStageFilter,
  parseStageSort,
  sortRowsByStage,
  type StageFilterRow,
} from "./stage-filter";
import { ENGAGEMENT_STAGES, type EngagementStage } from "./stage";

const row = (
  stage: EngagementStage | null,
  recencyAt = "2026-01-01T00:00:00.000Z",
): StageFilterRow => ({ stage, recencyAt });

describe("FILTERABLE_STAGES", () => {
  it("is every stage except completed, in workflow order", () => {
    expect(FILTERABLE_STAGES).toEqual([
      "collecting",
      "in_review",
      "in_preparation",
      "awaiting_signature",
      "awaiting_payment",
    ]);
  });

  it("excludes completed — those live in the Completed lifecycle tab", () => {
    expect(FILTERABLE_STAGES).not.toContain("completed");
  });
});

describe("countByStage", () => {
  it("counts rows per stage", () => {
    const counts = countByStage([
      row("collecting"),
      row("collecting"),
      row("in_review"),
    ]);
    expect(counts.collecting).toBe(2);
    expect(counts.in_review).toBe(1);
    expect(counts.in_preparation).toBe(0);
  });

  it("returns a zero for every stage, so no chip is ever missing a count", () => {
    const counts = countByStage([]);
    for (const s of ENGAGEMENT_STAGES) expect(counts[s]).toBe(0);
  });

  it("ignores rows with no stage (drafts share the Active view)", () => {
    const counts = countByStage([row(null), row(null), row("collecting")]);
    expect(counts.collecting).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("filterRowsByStage", () => {
  const rows = [row("collecting"), row("in_review"), row(null)];

  it("narrows to one stage", () => {
    expect(filterRowsByStage(rows, "collecting")).toHaveLength(1);
  });

  it("a null filter is 'All' — everything passes, drafts included", () => {
    expect(filterRowsByStage(rows, null)).toHaveLength(3);
  });

  it("never matches a stageless row — a draft isn't AT a stage", () => {
    for (const s of FILTERABLE_STAGES) {
      expect(filterRowsByStage([row(null)], s)).toHaveLength(0);
    }
  });
});

describe("sortRowsByStage", () => {
  it("ascending puts the earliest workflow position first", () => {
    const sorted = sortRowsByStage(
      [row("awaiting_payment"), row("collecting"), row("in_preparation")],
      "asc",
    );
    expect(sorted.map((r) => r.stage)).toEqual([
      "collecting",
      "in_preparation",
      "awaiting_payment",
    ]);
  });

  it("descending reverses it", () => {
    const sorted = sortRowsByStage(
      [row("collecting"), row("awaiting_payment"), row("in_preparation")],
      "desc",
    );
    expect(sorted.map((r) => r.stage)).toEqual([
      "awaiting_payment",
      "in_preparation",
      "collecting",
    ]);
  });

  it("orders by WORKFLOW position, not alphabetically", () => {
    // Alphabetically "awaiting_payment" < "collecting" < "in_review"; by
    // workflow it's the other way round. This is the whole point of the sort.
    const sorted = sortRowsByStage(
      [row("in_review"), row("awaiting_payment"), row("collecting")],
      "asc",
    );
    expect(sorted.map((r) => r.stage)).toEqual([
      "collecting",
      "in_review",
      "awaiting_payment",
    ]);
  });

  it("breaks ties within a stage by newest first (the table's default order)", () => {
    const sorted = sortRowsByStage(
      [
        row("collecting", "2026-01-01T00:00:00.000Z"),
        row("collecting", "2026-03-01T00:00:00.000Z"),
        row("collecting", "2026-02-01T00:00:00.000Z"),
      ],
      "asc",
    );
    expect(sorted.map((r) => r.recencyAt.slice(0, 7))).toEqual([
      "2026-03",
      "2026-02",
      "2026-01",
    ]);
  });

  it("keeps the newest-first tie-break in descending too", () => {
    const sorted = sortRowsByStage(
      [
        row("in_review", "2026-01-01T00:00:00.000Z"),
        row("in_review", "2026-03-01T00:00:00.000Z"),
      ],
      "desc",
    );
    expect(sorted[0].recencyAt.slice(0, 7)).toBe("2026-03");
  });

  it("puts stageless rows LAST in ascending", () => {
    const sorted = sortRowsByStage([row(null), row("collecting")], "asc");
    expect(sorted.map((r) => r.stage)).toEqual(["collecting", null]);
  });

  it("puts stageless rows LAST in descending too — they have no position to rank", () => {
    // The tempting alternative (treat null as "before collecting") would bury
    // the finished work the desc sort was reaching for behind every draft.
    const sorted = sortRowsByStage([row(null), row("collecting")], "desc");
    expect(sorted.map((r) => r.stage)).toEqual(["collecting", null]);
  });

  it("orders stageless rows among themselves by recency", () => {
    const sorted = sortRowsByStage(
      [
        row(null, "2026-01-01T00:00:00.000Z"),
        row(null, "2026-05-01T00:00:00.000Z"),
      ],
      "asc",
    );
    expect(sorted[0].recencyAt.slice(0, 7)).toBe("2026-05");
  });

  it("does not mutate the input array", () => {
    const rows = [row("awaiting_payment"), row("collecting")];
    const before = rows.map((r) => r.stage);
    sortRowsByStage(rows, "asc");
    expect(rows.map((r) => r.stage)).toEqual(before);
  });

  it("handles an empty list", () => {
    expect(sortRowsByStage([], "asc")).toEqual([]);
  });
});

describe("parseStageFilter", () => {
  it("accepts every filterable stage", () => {
    for (const s of FILTERABLE_STAGES) expect(parseStageFilter(s)).toBe(s);
  });

  it("rejects completed — it has no chip, so it could never be cleared", () => {
    // Otherwise a hand-typed ?stage=completed would empty the Active table with
    // no chip lit up to explain why or to click off.
    expect(parseStageFilter("completed")).toBeNull();
  });

  it("treats junk, empty and missing as no filter", () => {
    expect(parseStageFilter("nonsense")).toBeNull();
    expect(parseStageFilter("")).toBeNull();
    expect(parseStageFilter(null)).toBeNull();
    expect(parseStageFilter(undefined)).toBeNull();
  });
});

describe("parseStageSort", () => {
  it("reads asc and desc when the sort key is stage", () => {
    expect(parseStageSort("stage", "asc")).toBe("asc");
    expect(parseStageSort("stage", "desc")).toBe("desc");
  });

  it("is null without the stage sort key — a stray ?dir can't reorder the table", () => {
    expect(parseStageSort(null, "asc")).toBeNull();
    expect(parseStageSort("title", "asc")).toBeNull();
    expect(parseStageSort(undefined, "desc")).toBeNull();
  });

  it("is null for a missing or junk direction", () => {
    expect(parseStageSort("stage", null)).toBeNull();
    expect(parseStageSort("stage", "sideways")).toBeNull();
  });
});

describe("nextStageSort", () => {
  it("cycles off -> asc -> desc -> off", () => {
    expect(nextStageSort(null)).toBe("asc");
    expect(nextStageSort("asc")).toBe("desc");
    expect(nextStageSort("desc")).toBeNull();
  });

  it("returns to the default in three clicks — the default stays reachable", () => {
    // A plain two-state toggle would strand the accountant in a stage sort with
    // no way back to "newest first" short of a reload.
    let s = nextStageSort(null);
    s = nextStageSort(s);
    s = nextStageSort(s);
    expect(s).toBeNull();
  });
});
