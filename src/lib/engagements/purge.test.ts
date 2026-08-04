import { describe, it, expect } from "vitest";
import { purgeExpiredDeletedEngagements, purgeOneEngagement } from "./purge";

// The 30-day cutoff boundary is unit-tested in lifecycle.test.ts
// (isPurgeableEngagement). Here we test the ORCHESTRATION given a set of
// already-expired rows — and above all the founder's 2026-08-04 ruling: a
// permanent engagement delete must NOT destroy the client's files. Live
// documents are re-homed to imported_documents (same storage objects, same
// name/type/folder/browse position, original timestamp); only files the firm
// had already binned lose their bytes; the engagement row is deleted last,
// with the re-homed rows rolled back if that delete fails.

type ExpiredRow = {
  id: string;
  firm_id: string;
  client_id: string;
  title: string | null;
  deleted_at: string | null;
};

// A document row as the purge reads it off uploaded_files / final_documents.
// Tests fill only what each case needs.
type DocRow = Record<string, unknown>;

function makeMock(opts: {
  expired: ExpiredRow[];
  filesByEngagement?: Record<string, DocRow[]>;
  finalsByEngagement?: Record<string, DocRow[]>;
  failDeleteIds?: Set<string>;
  failImportInsert?: boolean;
}) {
  const recorded = {
    deletedIds: [] as string[],
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    rolledBackImportIds: [] as string[],
  };
  const files = opts.filesByEngagement ?? {};
  const finals = opts.finalsByEngagement ?? {};
  let importedSeq = 0;

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
      // imported_documents rollback: delete().in("id", ids)
      in(_col: string, ids: string[]) {
        recorded.rolledBackImportIds.push(...ids);
        return Promise.resolve({ error: null });
      },
      insert(rowOrRows: Record<string, unknown> | Record<string, unknown>[]) {
        const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        const failed = table === "imported_documents" && opts.failImportInsert;
        if (!failed) {
          for (const row of rows) recorded.inserts.push({ table, row });
        }
        // Real builders are thenables that also expose .select() — the purge
        // awaits activity_log inserts directly and chains .select("id") on the
        // imported_documents insert.
        const result = failed
          ? { data: null, error: { message: "insert boom" } }
          : {
              data: rows.map(() => ({ id: `imp${++importedSeq}` })),
              error: null,
            };
        return {
          select: () => Promise.resolve(result),
          then: (
            onOk: (v: { error: unknown }) => unknown,
            onErr?: (e: unknown) => unknown,
          ) =>
            Promise.resolve({ error: failed ? result.error : null }).then(
              onOk,
              onErr,
            ),
        };
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

const ENG: ExpiredRow = {
  id: "e1",
  firm_id: "f1",
  client_id: "c1",
  title: "T1 2024",
  deleted_at: "x",
};

describe("purgeExpiredDeletedEngagements", () => {
  it("re-homes live files to the client, removes only binned bytes, deletes each row", async () => {
    const mock = makeMock({
      expired: [ENG, { ...ENG, id: "e2", title: "T2 2024", deleted_at: "y" }],
      filesByEngagement: {
        e1: [
          // Live client upload: kept. Manual type absent, but the AI's answer
          // clears the shared trust threshold — it must survive as the type.
          {
            storage_path: "p1",
            original_filename: "t4.pdf",
            display_name: "T4 — employer",
            mime_type: "application/pdf",
            size_bytes: 123,
            manual_doc_type: null,
            browse_year: 2024,
            browse_category: "federal",
            folder_id: "fold1",
            visibility: "client",
            deleted_at: null,
            content_hash: "hash1",
            ai_classification: "t4",
            ai_confidence: 0.91,
            uploaded_at: "2026-01-02T03:04:05.000Z",
          },
          // Already binned by the firm: its bytes go, it is NOT re-homed.
          { storage_path: "p2", original_filename: "old.pdf", deleted_at: "z" },
          // No bytes in the bucket: nothing to keep or remove.
          { storage_path: null, original_filename: "ghost.pdf", deleted_at: null },
        ],
        e2: [],
      },
      finalsByEngagement: {
        // Live deliverable: kept, with its manual type and folder verbatim.
        e1: [
          {
            storage_path: "d1",
            original_filename: "return.pdf",
            display_name: null,
            mime_type: "application/pdf",
            size_bytes: 456,
            manual_doc_type: "t1_return",
            browse_year: 2024,
            browse_category: "federal",
            folder_id: null,
            visibility: "client",
            deleted_at: null,
            created_at: "2026-02-03T04:05:06.000Z",
          },
        ],
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
    expect(result.filesRehomed).toBe(2);
    expect(result.filesRemoved).toBe(1);

    // ONLY the binned file's bytes are removed — never a live file's.
    expect(removed).toEqual([["p2"]]);

    // Both rows hard-deleted.
    expect(mock.recorded.deletedIds).toEqual(["e1", "e2"]);

    // The live files became client-level imported_documents rows pointing at
    // the SAME storage objects, carrying what the firm already gave them.
    const rehomed = mock.recorded.inserts.filter(
      (i) => i.table === "imported_documents",
    );
    expect(rehomed).toHaveLength(2);
    expect(rehomed[0].row).toMatchObject({
      firm_id: "f1",
      client_id: "c1",
      import_run_id: null,
      storage_path: "p1",
      original_filename: "t4.pdf",
      display_name: "T4 — employer",
      mime_type: "application/pdf",
      size_bytes: 123,
      content_hash: "hash1",
      source_path: "T1 2024",
      folder_id: "fold1",
      visibility: "client",
      browse_year: 2024,
      browse_category: "federal",
      // The trusted AI answer, snapshotted — imported_documents has no AI
      // columns and nothing will re-classify this row.
      manual_doc_type: "t4",
      imported_by: null,
      created_at: "2026-01-02T03:04:05.000Z",
    });
    expect(rehomed[1].row).toMatchObject({
      storage_path: "d1",
      original_filename: "return.pdf",
      manual_doc_type: "t1_return",
      created_at: "2026-02-03T04:05:06.000Z",
    });

    // A durable, engagement_id-null purge row logged for each, counting the
    // files that were re-homed.
    const purgeLogs = mock.recorded.inserts.filter(
      (i) => i.table === "activity_log",
    );
    expect(purgeLogs).toHaveLength(2);
    expect(purgeLogs[0].row).toMatchObject({
      firm_id: "f1",
      engagement_id: null,
      actor_type: "system",
      action: "engagement_purged",
      metadata: { engagement_id: "e1", title: "T1 2024", files_rehomed: 2 },
    });
    expect(purgeLogs[1].row).toMatchObject({
      metadata: { engagement_id: "e2", files_rehomed: 0 },
    });
  });

  it("isolates a failed row so the rest of the batch still purges", async () => {
    const mock = makeMock({
      expired: [
        { id: "bad", firm_id: "f1", client_id: "c1", title: null, deleted_at: "x" },
        { id: "good", firm_id: "f1", client_id: "c1", title: null, deleted_at: "y" },
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
  it("records the requesting user in the purge log and as the re-homer", async () => {
    const mock = makeMock({
      expired: [],
      filesByEngagement: {
        e9: [
          {
            storage_path: "p1",
            original_filename: "gst.pdf",
            deleted_at: null,
            uploaded_at: "2026-03-04T00:00:00.000Z",
          },
        ],
      },
    });

    await purgeOneEngagement(
      { supabase: mock.supabase, removeStorageObjects: async () => {} },
      { id: "e9", firm_id: "f1", client_id: "c7", title: "GST 2026", deleted_at: "z" },
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
      metadata: { engagement_id: "e9", title: "GST 2026", files_rehomed: 1 },
    });
    const rehomed = mock.recorded.inserts.find(
      (i) => i.table === "imported_documents",
    );
    expect(rehomed?.row).toMatchObject({ client_id: "c7", imported_by: "u42" });
  });

  it("aborts BEFORE deleting anything when the re-home insert fails", async () => {
    const mock = makeMock({
      expired: [],
      filesByEngagement: {
        e1: [{ storage_path: "p1", original_filename: "a.pdf", deleted_at: null }],
      },
      failImportInsert: true,
    });
    const removed: string[][] = [];

    await expect(
      purgeOneEngagement(
        {
          supabase: mock.supabase,
          removeStorageObjects: async (paths) => {
            removed.push(paths);
          },
        },
        ENG,
      ),
    ).rejects.toMatchObject({ message: "insert boom" });

    // Nothing destroyed: no engagement delete, no storage removal.
    expect(mock.recorded.deletedIds).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("rolls the re-homed rows back when the engagement delete fails", async () => {
    const mock = makeMock({
      expired: [],
      filesByEngagement: {
        e1: [{ storage_path: "p1", original_filename: "a.pdf", deleted_at: null }],
      },
      failDeleteIds: new Set(["e1"]),
    });

    await expect(
      purgeOneEngagement(
        { supabase: mock.supabase, removeStorageObjects: async () => {} },
        ENG,
      ),
    ).rejects.toMatchObject({ message: "delete boom" });

    // The just-inserted imported_documents rows were removed again, so a
    // retry can't double the client's files.
    expect(mock.recorded.rolledBackImportIds).toEqual(["imp1"]);
  });

  it("still succeeds when removing binned bytes fails after the delete", async () => {
    const mock = makeMock({
      expired: [],
      filesByEngagement: {
        e1: [{ storage_path: "p2", original_filename: "old.pdf", deleted_at: "z" }],
      },
    });

    const res = await purgeOneEngagement(
      {
        supabase: mock.supabase,
        removeStorageObjects: async () => {
          throw new Error("bucket down");
        },
      },
      ENG,
    );

    // The purge already happened; orphaned bytes are the benign direction.
    expect(mock.recorded.deletedIds).toEqual(["e1"]);
    expect(res.filesRemoved).toBe(0);
  });

  it("never removes a storage path a live file still points at", async () => {
    const mock = makeMock({
      expired: [],
      filesByEngagement: {
        // A binned row sharing the live row's path: the bytes must survive.
        e1: [
          { storage_path: "shared", original_filename: "a.pdf", deleted_at: null },
          { storage_path: "shared", original_filename: "b.pdf", deleted_at: "z" },
        ],
      },
    });
    const removed: string[][] = [];

    const res = await purgeOneEngagement(
      {
        supabase: mock.supabase,
        removeStorageObjects: async (paths) => {
          removed.push(paths);
        },
      },
      ENG,
    );

    expect(removed).toEqual([]);
    expect(res).toEqual({ filesRemoved: 0, filesRehomed: 1 });
  });
});
