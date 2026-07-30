import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBrowseAxesForUpload } from "./browse-axes-sync";

function makeStub(opts: {
  row?: Record<string, unknown> | null;
  rowError?: string;
  engagement?: Record<string, unknown> | null;
  updateError?: string;
}) {
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from: (table: string) => {
      if (table === "uploaded_files") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.rowError
                  ? { data: null, error: { message: opts.rowError } }
                  : { data: opts.row ?? null, error: null },
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: async () => {
              if (opts.updateError) return { error: { message: opts.updateError } };
              updates.push(values);
              return { error: null };
            },
          }),
        };
      }
      if (table === "engagements") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.engagement ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
  return { supabase, updates };
}

const input = {
  fileId: "f1",
  engagementId: "e1",
  aiDocType: "t4",
  aiConfidence: 0.95,
  extractedYear: 2024,
};

describe("syncBrowseAxesForUpload", () => {
  it("stays dormant — and never throws — before the migration is applied", async () => {
    // This runs inside the classify worker. If it threw, or if it were wired
    // into that worker's own reads, a missing column would take down
    // classification itself. It must degrade to a warning and nothing else.
    const { supabase, updates } = makeStub({ rowError: "column missing" });
    const res = await syncBrowseAxesForUpload(supabase, input);
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("writes the derived axes for a fresh classification", async () => {
    const { supabase, updates } = makeStub({
      row: {
        browse_year: null,
        browse_category: null,
        browse_year_manual: false,
        browse_category_manual: false,
      },
      engagement: { title: "T1 2022", tax_year: 2023 },
    });
    const res = await syncBrowseAxesForUpload(supabase, input);
    expect(res).toEqual({ ok: true, changed: true });
    expect(updates[0].browse_year).toBe(2024);
    expect(updates[0].browse_category).toBe("federal");
    expect(updates[0].browse_axes_at).toBeTypeOf("string");
  });

  it("re-classification never moves a file the accountant sorted by hand", async () => {
    // The invariant. Somebody moved this to 2019/Bookkeeping; the model
    // disagreeing later is not a reason to undo them.
    const { supabase, updates } = makeStub({
      row: {
        browse_year: 2019,
        browse_category: "bookkeeping",
        browse_year_manual: true,
        browse_category_manual: true,
      },
      engagement: {},
    });
    const res = await syncBrowseAxesForUpload(supabase, input);
    expect(res).toEqual({ ok: true, changed: false });
    expect(updates[0]).not.toHaveProperty("browse_year");
    expect(updates[0]).not.toHaveProperty("browse_category");
    expect(updates[0].browse_axes_at).toBeTypeOf("string");
  });

  it("still resolves a year when the engagement cannot be read", async () => {
    const { supabase, updates } = makeStub({
      row: {
        browse_year: null,
        browse_category: null,
        browse_year_manual: false,
        browse_category_manual: false,
      },
      engagement: null,
    });
    await syncBrowseAxesForUpload(supabase, input);
    expect(updates[0].browse_year).toBe(2024);
  });

  it("reports a failed write instead of pretending it landed", async () => {
    const { supabase } = makeStub({
      row: {
        browse_year: null,
        browse_category: null,
        browse_year_manual: false,
        browse_category_manual: false,
      },
      updateError: "deadlock",
    });
    const res = await syncBrowseAxesForUpload(supabase, input);
    expect(res).toEqual({ ok: false, reason: "deadlock" });
  });

  it("handles the file disappearing mid-classification", async () => {
    const { supabase } = makeStub({ row: null });
    const res = await syncBrowseAxesForUpload(supabase, input);
    expect(res).toEqual({ ok: false, reason: "file gone" });
  });
});
