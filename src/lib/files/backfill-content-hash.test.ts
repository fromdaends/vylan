import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  backfillContentHashes,
  BACKFILL_FAILED_SENTINEL,
} from "./backfill-content-hash";
import { computeContentHash } from "./content-hash";

// Minimal stub of the two supabase surfaces the backfill touches: the
// uploaded_files select/update chain and storage.download. Records updates so
// assertions can check exactly what was written.
function makeStub(opts: {
  rows: { id: string; storage_path: string }[];
  // storage_path -> file bytes; a missing path simulates a download failure.
  blobs: Record<string, Uint8Array>;
}) {
  const updates: { id: string; content_hash: string }[] = [];
  const supabase = {
    from: (table: string) => {
      if (table !== "uploaded_files") throw new Error(`unexpected ${table}`);
      return {
        select: () => ({
          is: () => ({
            order: () => ({
              limit: async () => ({ data: opts.rows, error: null }),
            }),
          }),
        }),
        update: (values: { content_hash: string }) => ({
          eq: (_col: string, id: string) => ({
            is: async () => {
              updates.push({ id, content_hash: values.content_hash });
              return { error: null };
            },
          }),
        }),
      };
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          const bytes = opts.blobs[path];
          if (!bytes) return { data: null, error: new Error("not found") };
          return {
            data: new Blob([Buffer.from(bytes)]),
            error: null,
          };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { supabase, updates };
}

describe("backfillContentHashes", () => {
  it("hashes downloadable legacy files and writes the real fingerprint", async () => {
    const bytes = new TextEncoder().encode("hello T4");
    const { supabase, updates } = makeStub({
      rows: [{ id: "f1", storage_path: "p/one.pdf" }],
      blobs: { "p/one.pdf": bytes },
    });

    const r = await backfillContentHashes(supabase);

    expect(r).toEqual({ scanned: 1, hashed: 1, failed: 0 });
    expect(updates).toEqual([
      { id: "f1", content_hash: computeContentHash(Buffer.from(bytes)) },
    ]);
  });

  it("marks an undownloadable file with the sentinel so the sweep drains", async () => {
    const { supabase, updates } = makeStub({
      rows: [{ id: "gone", storage_path: "p/missing.pdf" }],
      blobs: {},
    });

    const r = await backfillContentHashes(supabase);

    expect(r).toEqual({ scanned: 1, hashed: 0, failed: 1 });
    expect(updates).toEqual([
      { id: "gone", content_hash: BACKFILL_FAILED_SENTINEL },
    ]);
  });

  it("is a no-op once nothing is left to backfill", async () => {
    const { supabase, updates } = makeStub({ rows: [], blobs: {} });
    const r = await backfillContentHashes(supabase);
    expect(r).toEqual({ scanned: 0, hashed: 0, failed: 0 });
    expect(updates).toEqual([]);
  });

  it("the sentinel is not a possible SHA-256 hex string", () => {
    expect(/^[0-9a-f]{64}$/.test(BACKFILL_FAILED_SENTINEL)).toBe(false);
  });
});
