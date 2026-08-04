import { describe, it, expect } from "vitest";
import { purgeExpiredDeletedEngagements, purgeOneEngagement } from "./purge";

// The 30-day cutoff boundary is unit-tested in lifecycle.test.ts
// (isPurgeableEngagement). Here we test the ORCHESTRATION given a set of
// already-expired rows: storage objects removed, a durable purge logged, and
// the row hard-deleted — with per-row failure isolation.

type ExpiredRow = {
  id: string;
  firm_id: string;
  title: string | null;
  deleted_at: string | null;
};

function makeMock(opts: {
  expired: ExpiredRow[];
  filesByEngagement?: Record<string, { storage_path: string | null }[]>;
  finalsByEngagement?: Record<string, { storage_path: string | null }[]>;
  failDeleteIds?: Set<string>;
}) {
  const recorded = {
    deletedIds: [] as string[],
    inserts: [] as { table: string; row: Record<string, unknown> }[],
  };
  const files = opts.filesByEngagement ?? {};
  const finals = opts.finalsByEngagement ?? {};

  function from(table: string) {
    const builder = {
      select() {
        return builder;
      },
      not() {
        return builder;
      },
      lt() {
        // Terminal for the engagements "find expired" query. The mock ignores
        // the cutoff filter (boundary logic lives in lifecycle.test.ts).
        return Promise.resolve({
          data: table === "engagements" ? opts.expired : [],
          error: null,
        });
      },
      eq(_col: string, val: string) {
        if (table === "uploaded_files") {
          return Promise.resolve({ data: files[val] ?? [], error: null });
        }
        if (table === "final_documents") {
          return Promise.resolve({ data: finals[val] ?? [], error: null });
        }
        // engagements: delete().eq("id", id)
        if (opts.failDeleteIds?.has(val)) {
          return Promise.resolve({ error: { message: "delete boom" } });
        }
        recorded.deletedIds.push(val);
        return Promise.resolve({ error: null });
      },
      insert(row: Record<string, unknown>) {
        recorded.inserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
      delete() {
        return builder;
      },
    };
    return builder;
  }

  return { recorded, supabase: { from } as never };
}

const NOW = Date.parse("2026-05-29T00:00:00.000Z");

describe("purgeExpiredDeletedEngagements", () => {
  it("removes storage files, logs a durable purge, and deletes each row", async () => {
    const mock = makeMock({
      expired: [
        { id: "e1", firm_id: "f1", title: "T1 2024", deleted_at: "x" },
        { id: "e2", firm_id: "f1", title: "T2 2024", deleted_at: "y" },
      ],
      filesByEngagement: {
        // null path is filtered out; e2 has no files.
        e1: [
          { storage_path: "p1" },
          { storage_path: null },
          { storage_path: "p2" },
        ],
        e2: [],
      },
      // Deliverables live in the same bucket and must be removed too.
      finalsByEngagement: {
        e1: [{ storage_path: "d1" }],
      },
    });
    const removed: string[][] = [];

    const result = await purgeExpiredDeletedEngagements({
      supabase: mock.supabase,
      removeStorageObjects: async (paths) => {
        removed.push(paths);
      },
      nowMs: NOW,
    });

    expect(result.purged).toEqual(["e1", "e2"]);
    expect(result.failed).toEqual([]);
    expect(result.filesRemoved).toBe(3);

    // Only e1 had files; nulls filtered out; uploads + deliverables in ONE
    // remove call; e2 (no files) triggers no remove.
    expect(removed).toEqual([["p1", "p2", "d1"]]);

    // Both rows hard-deleted.
    expect(mock.recorded.deletedIds).toEqual(["e1", "e2"]);

    // A durable, engagement_id-null purge row logged for each.
    const purgeLogs = mock.recorded.inserts.filter(
      (i) => i.table === "activity_log",
    );
    expect(purgeLogs).toHaveLength(2);
    expect(purgeLogs[0].row).toMatchObject({
      firm_id: "f1",
      engagement_id: null,
      actor_type: "system",
      action: "engagement_purged",
      metadata: { engagement_id: "e1", title: "T1 2024" },
    });
  });

  it("isolates a failed row so the rest of the batch still purges", async () => {
    const mock = makeMock({
      expired: [
        { id: "bad", firm_id: "f1", title: null, deleted_at: "x" },
        { id: "good", firm_id: "f1", title: null, deleted_at: "y" },
      ],
      failDeleteIds: new Set(["bad"]),
    });

    const result = await purgeExpiredDeletedEngagements({
      supabase: mock.supabase,
      removeStorageObjects: async () => {},
      nowMs: NOW,
    });

    expect(result.purged).toEqual(["good"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe("bad");
    expect(mock.recorded.deletedIds).toEqual(["good"]);
  });
});

describe("purgeOneEngagement", () => {
  it("records the requesting user in the durable purge log", async () => {
    const mock = makeMock({ expired: [] });

    await purgeOneEngagement(
      { supabase: mock.supabase, removeStorageObjects: async () => {} },
      { id: "e9", firm_id: "f1", title: "GST 2026", deleted_at: "z" },
      { type: "user", id: "u42" },
    );

    expect(mock.recorded.deletedIds).toEqual(["e9"]);
    const log = mock.recorded.inserts.find((i) => i.table === "activity_log");
    expect(log?.row).toMatchObject({
      firm_id: "f1",
      engagement_id: null,
      actor_type: "user",
      actor_id: "u42",
      action: "engagement_purged",
      metadata: { engagement_id: "e9", title: "GST 2026" },
    });
  });
});
