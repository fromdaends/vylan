import { describe, it, expect, vi } from "vitest";

// The apply step re-derives item status via recomputeItemStatus; mock it so we
// can assert it was called (its roll-up logic is covered by the rollup tests).
const recomputeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/db/file-review", () => ({
  recomputeItemStatus: (...args: unknown[]) => recomputeMock(...args),
}));

import {
  findDuplicateOriginalId,
  decideDuplicate,
  applyDuplicateDecision,
  DUPLICATE_REASON,
  type DuplicateCandidate,
} from "./duplicates";
import { BACKFILL_FAILED_SENTINEL } from "@/lib/files/backfill-content-hash";

const cand = (
  id: string,
  content_hash: string | null,
  uploaded_at: string,
): DuplicateCandidate => ({ id, content_hash, uploaded_at });

describe("findDuplicateOriginalId", () => {
  it("returns null when the new upload is unique", () => {
    expect(
      findDuplicateOriginalId("h-new", [
        cand("a", "h-x", "2026-01-01T00:00:00Z"),
        cand("b", "h-y", "2026-01-02T00:00:00Z"),
      ]),
    ).toBeNull();
  });

  it("returns the matching earlier file's id (a byte-identical re-upload)", () => {
    expect(
      findDuplicateOriginalId("h-1", [
        cand("orig", "h-1", "2026-01-01T00:00:00Z"),
        cand("other", "h-2", "2026-01-02T00:00:00Z"),
      ]),
    ).toBe("orig");
  });

  it("returns the EARLIEST match when several identical copies already exist", () => {
    expect(
      findDuplicateOriginalId("h-1", [
        cand("late", "h-1", "2026-03-01T00:00:00Z"),
        cand("first", "h-1", "2026-01-01T00:00:00Z"),
        cand("mid", "h-1", "2026-02-01T00:00:00Z"),
      ]),
    ).toBe("first");
  });

  it("never matches when the new upload has no fingerprint", () => {
    expect(
      findDuplicateOriginalId(null, [cand("a", "h-1", "2026-01-01T00:00:00Z")]),
    ).toBeNull();
  });

  it("backfill sentinel rows are inert — they can never match a real hash", () => {
    // The content-hash backfill marks undownloadable legacy files with a
    // sentinel instead of NULL. A real upload's hash is 64-hex SHA-256, so a
    // sentinel candidate must never be reported as its original.
    const realHash = "a".repeat(64);
    expect(
      findDuplicateOriginalId(realHash, [
        cand("broken", BACKFILL_FAILED_SENTINEL, "2026-01-01T00:00:00Z"),
        cand("broken2", BACKFILL_FAILED_SENTINEL, "2026-01-02T00:00:00Z"),
      ]),
    ).toBeNull();
  });

  it("ignores candidates with no fingerprint (legacy / pre-feature uploads)", () => {
    expect(
      findDuplicateOriginalId("h-1", [
        cand("legacy", null, "2026-01-01T00:00:00Z"),
      ]),
    ).toBeNull();
  });

  it("returns null for an empty candidate set", () => {
    expect(findDuplicateOriginalId("h-1", [])).toBeNull();
  });
});

describe("decideDuplicate", () => {
  it("auto-rejects when the separate duplicate setting is ON", () => {
    expect(decideDuplicate(true)).toBe("auto_reject");
  });
  it("only flags when the setting is OFF", () => {
    expect(decideDuplicate(false)).toBe("flag");
  });
});

// ── Mock supabase recorder (mirrors lib/ai/router-dispatch.test.ts) ───────────
type Recorded = {
  updates: {
    table: string;
    values: Record<string, unknown>;
    eq: [string, unknown];
  }[];
  inserts: { table: string; values: Record<string, unknown> }[];
};

function makeMockSupabase() {
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
    };
  }
  return { recorded, supabase: { from } as never };
}

const COMMON = {
  fileId: "dup-1",
  originalFileId: "orig-1",
  requestItemId: "item-1",
  engagementId: "eng-1",
  firmId: "firm-1",
  clientLocale: "en" as const,
};

describe("applyDuplicateDecision", () => {
  it("auto_reject: marks a rejected duplicate (is_duplicate + duplicate_of + review_status + reason), recomputes, audits", async () => {
    recomputeMock.mockClear();
    const { supabase, recorded } = makeMockSupabase();
    await applyDuplicateDecision({
      supabase,
      decision: "auto_reject",
      ...COMMON,
    });

    const fileUpdate = recorded.updates.find(
      (u) => u.table === "uploaded_files",
    );
    expect(fileUpdate?.eq).toEqual(["id", "dup-1"]);
    expect(fileUpdate?.values.is_duplicate).toBe(true);
    expect(fileUpdate?.values.duplicate_of_file_id).toBe("orig-1");
    expect(fileUpdate?.values.review_status).toBe("rejected");
    expect(fileUpdate?.values.rejection_reason).toBe(DUPLICATE_REASON.en);

    expect(recomputeMock).toHaveBeenCalledWith(supabase, "item-1");

    const activity = recorded.inserts.find((i) => i.table === "activity_log");
    expect(activity?.values.action).toBe("duplicate_auto_rejected");
    expect(activity?.values.metadata).toMatchObject({
      uploaded_file_id: "dup-1",
      duplicate_of_file_id: "orig-1",
    });
  });

  it("flag: marks is_duplicate + duplicate_of but does NOT reject the file, recomputes, audits", async () => {
    recomputeMock.mockClear();
    const { supabase, recorded } = makeMockSupabase();
    await applyDuplicateDecision({ supabase, decision: "flag", ...COMMON });

    const fileUpdate = recorded.updates.find(
      (u) => u.table === "uploaded_files",
    );
    expect(fileUpdate?.values.is_duplicate).toBe(true);
    expect(fileUpdate?.values.duplicate_of_file_id).toBe("orig-1");
    // Crucially NOT rejected when only flagging.
    expect(fileUpdate?.values.review_status).toBeUndefined();
    expect(fileUpdate?.values.rejection_reason).toBeUndefined();

    expect(recomputeMock).toHaveBeenCalledWith(supabase, "item-1");

    const activity = recorded.inserts.find((i) => i.table === "activity_log");
    expect(activity?.values.action).toBe("duplicate_flagged");
  });

  it("uses the French duplicate reason for a French-locale client", async () => {
    const { supabase, recorded } = makeMockSupabase();
    await applyDuplicateDecision({
      supabase,
      decision: "auto_reject",
      ...COMMON,
      clientLocale: "fr",
    });
    const fileUpdate = recorded.updates.find(
      (u) => u.table === "uploaded_files",
    );
    expect(fileUpdate?.values.rejection_reason).toBe(DUPLICATE_REASON.fr);
  });
});
