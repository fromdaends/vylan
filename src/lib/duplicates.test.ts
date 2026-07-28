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
  isFieldDuplicate,
  findFieldDuplicateOriginalId,
  type FieldDuplicateDoc,
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

describe("near-duplicate detection (Dext rules)", () => {
  const doc = (over: Partial<FieldDuplicateDoc> = {}): FieldDuplicateDoc => ({
    id: "f1",
    supplier: "Boréal Traiteur",
    total: 114.98,
    documentNumber: "INV-2041",
    documentDate: "2026-06-14",
    uploadedAt: "2026-06-15T10:00:00Z",
    ...over,
  });

  it("matches the same invoice re-uploaded as a different file", () => {
    expect(isFieldDuplicate(doc(), doc({ id: "f2" }))).toBe(true);
  });

  // The point of Dext's split: an invoice's date is ambiguous (issue / due /
  // service period) but its number is its identity.
  it("ignores the date when both documents are numbered", () => {
    expect(
      isFieldDuplicate(doc(), doc({ id: "f2", documentDate: "2026-06-30" })),
    ).toBe(true);
  });

  it("is not a duplicate when the numbers differ", () => {
    expect(
      isFieldDuplicate(doc(), doc({ id: "f2", documentNumber: "INV-2042" })),
    ).toBe(false);
  });

  it("survives punctuation, suffix and ACCENT drift in the supplier", () => {
    // Two reads of the same Quebec supplier routinely differ by an accent.
    expect(
      isFieldDuplicate(
        doc({ supplier: "Boréal Traiteur Inc." }),
        doc({ id: "f2", supplier: "boreal traiteur" }),
      ),
    ).toBe(true);
    expect(
      isFieldDuplicate(
        doc({ supplier: "Central Copiers Inc." }),
        doc({ id: "f2", supplier: "  central copiers, ltd " }),
      ),
    ).toBe(true);
  });

  it("compares money in cents, not floats", () => {
    expect(isFieldDuplicate(doc({ total: 114.98 }), doc({ id: "f2", total: 114.98 }))).toBe(true);
    expect(isFieldDuplicate(doc({ total: 114.98 }), doc({ id: "f2", total: 114.99 }))).toBe(false);
  });

  describe("receipts with no document number", () => {
    const r = (over: Partial<FieldDuplicateDoc> = {}) =>
      doc({ documentNumber: null, ...over });

    it("falls back to supplier + date + total", () => {
      expect(isFieldDuplicate(r(), r({ id: "f2" }))).toBe(true);
    });

    it("is not a duplicate on a different date", () => {
      expect(
        isFieldDuplicate(r(), r({ id: "f2", documentDate: "2026-06-15" })),
      ).toBe(false);
    });
  });

  // The monthly-retainer false positive: same supplier, same amount, but one
  // document printed a number and the other didn't. Not enough to call it.
  it("does not match a numbered document against an unnumbered one", () => {
    expect(
      isFieldDuplicate(doc(), doc({ id: "f2", documentNumber: null })),
    ).toBe(false);
  });

  // Dext is explicit that missing key fields mean no match. Guessing here would
  // flag unrelated documents at each other.
  it("never matches without a supplier or without an amount", () => {
    expect(isFieldDuplicate(doc({ supplier: null }), doc({ id: "f2" }))).toBe(false);
    expect(isFieldDuplicate(doc({ total: null }), doc({ id: "f2" }))).toBe(false);
  });

  it("ignores a document number too short to be an identity", () => {
    // "1" on both would otherwise collide across unrelated documents; with no
    // usable number on either side it falls back to the date, which matches.
    expect(
      isFieldDuplicate(
        doc({ documentNumber: "1" }),
        doc({ id: "f2", documentNumber: "1" }),
      ),
    ).toBe(true);
    expect(
      isFieldDuplicate(
        doc({ documentNumber: "1" }),
        doc({ id: "f2", documentNumber: "1", documentDate: "2026-07-01" }),
      ),
    ).toBe(false);
  });

  describe("findFieldDuplicateOriginalId", () => {
    it("returns the EARLIEST match and never the document itself", () => {
      const self = doc({ id: "self", uploadedAt: "2026-06-20T10:00:00Z" });
      expect(
        findFieldDuplicateOriginalId(self, [
          self,
          doc({ id: "later", uploadedAt: "2026-06-18T10:00:00Z" }),
          doc({ id: "earliest", uploadedAt: "2026-06-01T10:00:00Z" }),
        ]),
      ).toBe("earliest");
    });

    it("returns null when nothing matches", () => {
      expect(
        findFieldDuplicateOriginalId(doc(), [
          doc({ id: "other", documentNumber: "INV-9999" }),
        ]),
      ).toBeNull();
    });
  });
});
