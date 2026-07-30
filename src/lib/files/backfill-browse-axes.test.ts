import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { backfillBrowseAxesBatch } from "./backfill-browse-axes";

type UploadRow = {
  id: string;
  engagement_id: string;
  ai_classification?: string | null;
  ai_confidence?: number | null;
  ai_extracted_fields?: Record<string, unknown> | null;
  browse_year?: number | null;
  browse_category?: string | null;
  browse_year_manual?: boolean | null;
  browse_category_manual?: boolean | null;
};

type EngRow = {
  id: string;
  title?: string | null;
  due_date?: string | null;
  tax_year?: number | null;
};

// Stub of the two tables the sweep reads. Records every update so assertions can
// check exactly what was written — including the stamp, which is the mechanism
// that makes the sweep terminate.
function makeStub(opts: {
  rows: UploadRow[];
  engagements?: EngRow[];
  selectError?: boolean;
  failUpdateFor?: string;
}) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const supabase = {
    from: (table: string) => {
      if (table === "uploaded_files") {
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                limit: async () =>
                  opts.selectError
                    ? { data: null, error: { message: "column missing" } }
                    : { data: opts.rows, error: null },
              }),
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              if (opts.failUpdateFor === id) {
                return { error: { message: "row vanished" } };
              }
              updates.push({ id, values });
              return { error: null };
            },
          }),
        };
      }
      if (table === "engagements") {
        return {
          select: () => ({
            in: async () => ({ data: opts.engagements ?? [], error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
  return { supabase, updates };
}

describe("backfillBrowseAxesBatch", () => {
  it("reports unavailable rather than throwing before the migration", async () => {
    const { supabase, updates } = makeStub({ rows: [], selectError: true });
    const res = await backfillBrowseAxesBatch(supabase);
    expect(res).toEqual({ scanned: 0, updated: 0, unavailable: true });
    expect(updates).toHaveLength(0);
  });

  it("is a no-op once the backlog is drained", async () => {
    const { supabase, updates } = makeStub({ rows: [] });
    expect(await backfillBrowseAxesBatch(supabase)).toEqual({
      scanned: 0,
      updated: 0,
    });
    expect(updates).toHaveLength(0);
  });

  it("fills in year and category from the document and its engagement", async () => {
    const { supabase, updates } = makeStub({
      rows: [
        {
          id: "f1",
          engagement_id: "e1",
          ai_classification: "t4",
          ai_confidence: 0.95,
          ai_extracted_fields: { extracted_year: 2024 },
        },
      ],
      engagements: [{ id: "e1", title: "T1 2022", tax_year: 2023 }],
    });
    const res = await backfillBrowseAxesBatch(supabase);
    expect(res.scanned).toBe(1);
    expect(res.updated).toBe(1);
    // The document's own year wins the chain over the engagement's.
    expect(updates[0].values.browse_year).toBe(2024);
    expect(updates[0].values.browse_category).toBe("federal");
  });

  it("falls back down the year chain when the document has no year", async () => {
    const { supabase, updates } = makeStub({
      rows: [{ id: "f1", engagement_id: "e1", ai_extracted_fields: {} }],
      engagements: [{ id: "e1", title: "T1 2022", due_date: "2021-04-30" }],
    });
    await backfillBrowseAxesBatch(supabase);
    expect(updates[0].values.browse_year).toBe(2022);
  });

  it("survives an engagement it cannot read", async () => {
    // Hard-purged mid-sweep: the chain just loses its engagement terms.
    const { supabase, updates } = makeStub({
      rows: [
        {
          id: "f1",
          engagement_id: "gone",
          ai_classification: "t4",
          ai_confidence: 0.95,
          ai_extracted_fields: { extracted_year: 2024 },
        },
      ],
      engagements: [],
    });
    const res = await backfillBrowseAxesBatch(supabase);
    expect(res.scanned).toBe(1);
    expect(updates[0].values.browse_year).toBe(2024);
  });

  it("stamps a row even when nothing changed, so the sweep terminates", async () => {
    // THE test for this module. An unstamped no-op row would be re-read on
    // every sweep forever.
    const { supabase, updates } = makeStub({
      rows: [
        {
          id: "f1",
          engagement_id: "e1",
          ai_classification: "t4",
          ai_confidence: 0.95,
          ai_extracted_fields: { extracted_year: 2024 },
          browse_year: 2024,
          browse_category: "federal",
        },
      ],
      engagements: [{ id: "e1" }],
    });
    const res = await backfillBrowseAxesBatch(supabase);
    expect(res.updated).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].values.browse_axes_at).toBeTypeOf("string");
    expect(updates[0].values).not.toHaveProperty("browse_year");
  });

  it("never overwrites an axis a human set", async () => {
    const { supabase, updates } = makeStub({
      rows: [
        {
          id: "f1",
          engagement_id: "e1",
          ai_classification: "t4",
          ai_confidence: 0.95,
          ai_extracted_fields: { extracted_year: 2024 },
          browse_year: 2019,
          browse_year_manual: true,
        },
      ],
      engagements: [{ id: "e1" }],
    });
    await backfillBrowseAxesBatch(supabase);
    expect(updates[0].values).not.toHaveProperty("browse_year");
    expect(updates[0].values.browse_category).toBe("federal");
  });

  it("leaves a failed row unstamped so a later sweep retries it", async () => {
    const { supabase, updates } = makeStub({
      rows: [
        { id: "f1", engagement_id: "e1" },
        { id: "f2", engagement_id: "e1" },
      ],
      engagements: [{ id: "e1" }],
      failUpdateFor: "f1",
    });
    const res = await backfillBrowseAxesBatch(supabase);
    // One bad row must not abort its 199 siblings.
    expect(res.scanned).toBe(2);
    expect(updates.map((u) => u.id)).toEqual(["f2"]);
  });
});
