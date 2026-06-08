import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UsabilityVerdict } from "./usability";

// Capture enqueueJob calls so we can assert the router queued (or
// didn't queue) a client-retry notification.
const enqueueJobMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/db/jobs", () => ({
  enqueueJob: (...args: unknown[]) => enqueueJobMock(...args),
}));

// The router now re-derives item status via recomputeItemStatus instead of
// writing request_items.status directly. Mock it so we can assert it was
// called (its roll-up logic is covered by the rollup tests).
const recomputeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/db/file-review", () => ({
  recomputeItemStatus: (...args: unknown[]) => recomputeMock(...args),
}));

import { applyDecision, decide } from "./router";

const VERDICT: UsabilityVerdict = {
  usable: false,
  confidence: 0.91,
  primary_issue: "text_unreadable",
  all_issues: ["text_unreadable"],
  issue_summary_fr: "Le texte est illisible.",
  issue_summary_en: "The text is not readable.",
};

// Minimal in-memory recorder so we can assert which tables got which
// payloads. Methods are chained the same way the supabase-js client
// chains: from(...).update(...).eq(...) etc.
type Recorded = {
  updates: { table: string; values: Record<string, unknown>; eq: [string, unknown] }[];
  inserts: { table: string; values: Record<string, unknown> }[];
};
type CountStub = {
  request_items?: number;
};

function makeMockSupabase(stub: CountStub = {}) {
  const recorded: Recorded = { updates: [], inserts: [] };
  function from(table: string) {
    return {
      update(values: Record<string, unknown>) {
        return {
          eq: (col: string, val: unknown) => {
            recorded.updates.push({ table, values, eq: [col, val] });
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
                data:
                  table === "request_items"
                    ? { ai_rejection_count: stub.request_items ?? 0 }
                    : null,
                error: null,
              }),
          }),
        };
      },
    };
  }
  return { recorded, supabase: { from } as never };
}

const COMMON = {
  verdict: VERDICT,
  fileId: "file-1",
  requestItemId: "item-1",
  engagementId: "eng-1",
  firmId: "firm-1",
  clientLocale: "fr" as const,
};

describe("applyDecision — auto_reject_and_notify_client", () => {
  beforeEach(() => enqueueJobMock.mockClear());

  it("rejects the file (flag + review_status + reason), increments the strike counter, recomputes the item, queues the notify job, and writes an audit row", async () => {
    recomputeMock.mockClear();
    const { supabase, recorded } = makeMockSupabase({ request_items: 0 });
    const result = await applyDecision({
      supabase,
      decision: "auto_reject_and_notify_client",
      ...COMMON,
    });

    expect(result).toEqual({
      decision: "auto_reject_and_notify_client",
      jobQueued: true,
    });

    // Strike counter went 0 → 1.
    const itemStrike = recorded.updates.find(
      (u) =>
        u.table === "request_items" &&
        typeof u.values.ai_rejection_count === "number",
    );
    expect(itemStrike?.values.ai_rejection_count).toBe(1);

    // File: flagged AND marked rejected with the client-facing reason, so the
    // item roll-up + portal treat it as a real (client-facing) rejection.
    const fileUpdate = recorded.updates.find(
      (u) => u.table === "uploaded_files",
    );
    expect(fileUpdate?.values.ai_rejected).toBe(true);
    expect(fileUpdate?.values.review_status).toBe("rejected");
    expect(fileUpdate?.values.rejection_reason).toBe("Le texte est illisible.");

    // Item status is re-derived from the files, not written directly.
    expect(recomputeMock).toHaveBeenCalledWith(supabase, "item-1");
    expect(
      recorded.updates.find(
        (u) => u.table === "request_items" && u.values.status !== undefined,
      ),
    ).toBeUndefined();

    // Activity log line.
    const activity = recorded.inserts.find((i) => i.table === "activity_log");
    expect(activity?.values.action).toBe("ai_auto_rejected");

    // Job queued with the right payload + correct kind.
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
    const [call] = enqueueJobMock.mock.calls;
    expect(call[0].kind).toBe("notify_client_retry");
    expect(call[0].payload.uploaded_file_id).toBe("file-1");
    expect(call[0].payload.language).toBe("fr");
    expect(call[0].payload.issue_summary_fr).toBe("Le texte est illisible.");
  });

  it("picks the right locale summary for an English client", async () => {
    const { supabase, recorded } = makeMockSupabase();
    await applyDecision({
      supabase,
      decision: "auto_reject_and_notify_client",
      ...COMMON,
      clientLocale: "en",
    });
    const fileUpdate = recorded.updates.find(
      (u) => u.table === "uploaded_files",
    );
    expect(fileUpdate?.values.rejection_reason).toBe(
      "The text is not readable.",
    );
    expect(enqueueJobMock.mock.calls[0][0].payload.language).toBe("en");
  });
});

describe("applyDecision — escalate_to_accountant", () => {
  beforeEach(() => enqueueJobMock.mockClear());

  it("flags the file, recomputes the item (no direct status write), does NOT increment the counter, logs ai_escalated_to_accountant, no job queued", async () => {
    recomputeMock.mockClear();
    const { supabase, recorded } = makeMockSupabase({ request_items: 2 });
    const result = await applyDecision({
      supabase,
      decision: "escalate_to_accountant",
      ...COMMON,
    });

    expect(result).toEqual({
      decision: "escalate_to_accountant",
      jobQueued: false,
    });

    // No direct request_items write at all (status comes from recompute; the
    // counter is intentionally left at 2 so an override decrement lands at 1).
    expect(
      recorded.updates.find((u) => u.table === "request_items"),
    ).toBeUndefined();
    expect(recomputeMock).toHaveBeenCalledWith(supabase, "item-1");

    // File flagged, but NOT marked review_status rejected (accountant-facing).
    const fileUpdate = recorded.updates.find(
      (u) => u.table === "uploaded_files",
    );
    expect(fileUpdate?.values.ai_rejected).toBe(true);
    expect(fileUpdate?.values.review_status).toBeUndefined();

    expect(
      recorded.inserts.find((i) => i.table === "activity_log")?.values.action,
    ).toBe("ai_escalated_to_accountant");

    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});

describe("applyDecision — queue_for_accountant", () => {
  beforeEach(() => enqueueJobMock.mockClear());

  it("recomputes the item (no direct status write), does NOT touch the file, logs ai_quality_flagged, no job queued, no counter change", async () => {
    recomputeMock.mockClear();
    const { supabase, recorded } = makeMockSupabase();
    const result = await applyDecision({
      supabase,
      decision: "queue_for_accountant",
      ...COMMON,
    });

    expect(result).toEqual({
      decision: "queue_for_accountant",
      jobQueued: false,
    });

    // No direct request_items write; the item is recomputed from its files.
    expect(
      recorded.updates.find((u) => u.table === "request_items"),
    ).toBeUndefined();
    expect(recomputeMock).toHaveBeenCalledWith(supabase, "item-1");

    // ai_rejected stays untouched on queue_for_accountant — only flagged.
    expect(
      recorded.updates.find((u) => u.table === "uploaded_files"),
    ).toBeUndefined();

    expect(
      recorded.inserts.find((i) => i.table === "activity_log")?.values.action,
    ).toBe("ai_quality_flagged");

    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});

describe("applyDecision — end-to-end matrix via decide()", () => {
  beforeEach(() => enqueueJobMock.mockClear());

  it.each([
    ["off, count 0", false, 0, "queue_for_accountant"],
    ["off, count 99", false, 99, "queue_for_accountant"],
    ["on, count 0", true, 0, "auto_reject_and_notify_client"],
    ["on, count 1", true, 1, "auto_reject_and_notify_client"],
    ["on, count 2", true, 2, "escalate_to_accountant"],
    ["on, count 5", true, 5, "escalate_to_accountant"],
  ])(
    "%s → %s",
    async (_label, autoRejectOn, rejectionCount, expectedDecision) => {
      const { supabase } = makeMockSupabase({ request_items: rejectionCount });
      const decision = decide({ autoRejectOn, rejectionCount });
      const result = await applyDecision({
        supabase,
        decision,
        ...COMMON,
      });
      expect(result.decision).toBe(expectedDecision);
    },
  );
});
