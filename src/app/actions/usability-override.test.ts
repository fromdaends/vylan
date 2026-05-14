import { describe, it, expect, beforeEach } from "vitest";
import { applyOverride } from "./usability-override";

type Recorded = {
  updates: { table: string; values: Record<string, unknown> }[];
  inserts: { table: string; values: Record<string, unknown> }[];
};

function makeMockSupabase(initialCount = 1) {
  const recorded: Recorded = { updates: [], inserts: [] };
  function from(table: string) {
    return {
      update(values: Record<string, unknown>) {
        return {
          eq: (_col: string, _val: unknown) => {
            recorded.updates.push({ table, values });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      insert(values: Record<string, unknown>) {
        recorded.inserts.push({ table, values });
        return Promise.resolve({ data: null, error: null });
      },
      select(_cols: string) {
        return {
          eq: (_col: string, _val: unknown) => ({
            single: () =>
              Promise.resolve({
                data: { ai_rejection_count: initialCount },
                error: null,
              }),
          }),
        };
      },
    };
  }
  return { recorded, supabase: { from } as never };
}

const BASE = {
  fileId: "file-1",
  requestItemId: "item-1",
  engagementId: "eng-1",
  firmId: "firm-1",
  overriddenByUserId: "user-1",
  originalIssue: "text_unreadable",
  overrideReason: "AI was wrong — it was perfectly legible.",
};

describe("applyOverride", () => {
  let mock: ReturnType<typeof makeMockSupabase>;

  beforeEach(() => {
    mock = makeMockSupabase(2);
  });

  it("clears ai_rejected on the file", async () => {
    await applyOverride(mock.supabase, BASE);
    const file = mock.recorded.updates.find(
      (u) => u.table === "uploaded_files",
    );
    expect(file?.values.ai_rejected).toBe(false);
  });

  it("inserts a row in ai_rejection_overrides with the original AI issue + override reason", async () => {
    await applyOverride(mock.supabase, BASE);
    const override = mock.recorded.inserts.find(
      (i) => i.table === "ai_rejection_overrides",
    );
    expect(override?.values).toMatchObject({
      file_id: "file-1",
      overridden_by_user_id: "user-1",
      original_issue: "text_unreadable",
      override_reason: "AI was wrong — it was perfectly legible.",
    });
  });

  it("decrements the strike counter and approves the item in a single update", async () => {
    await applyOverride(mock.supabase, BASE);
    const item = mock.recorded.updates.find((u) => u.table === "request_items");
    expect(item?.values).toMatchObject({
      status: "approved",
      ai_rejection_count: 1, // 2 → 1
      approved_by: "user-1",
    });
    expect(typeof item?.values.approved_at).toBe("string");
  });

  it("clamps the strike counter at zero (never negative)", async () => {
    const m = makeMockSupabase(0);
    await applyOverride(m.supabase, BASE);
    const item = m.recorded.updates.find((u) => u.table === "request_items");
    expect(item?.values.ai_rejection_count).toBe(0);
  });

  it("logs an ai_rejection_overridden activity entry", async () => {
    await applyOverride(mock.supabase, BASE);
    const activity = mock.recorded.inserts.find(
      (i) => i.table === "activity_log",
    );
    expect(activity?.values).toMatchObject({
      firm_id: "firm-1",
      engagement_id: "eng-1",
      actor_type: "user",
      actor_id: "user-1",
      action: "ai_rejection_overridden",
    });
  });
});
