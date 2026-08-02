import { describe, it, expect } from "vitest";
import {
  categoryMisfile,
  duplicateSuggestions,
  lunaCandidates,
  proposalsToSuggestions,
  stateMatches,
  stateOf,
  LOW_CONFIDENCE_THRESHOLD,
  type ScanRow,
} from "./organize";

// The scanner proposes; humans approve. These tests pin the PROPOSING rules —
// the part that decides what lands in front of the accountant. A wrong rule
// here is either noise (suggestions about nothing) or silence (real problems
// never surfaced), and both erode trust in the whole queue.

function row(over: Partial<ScanRow> = {}): ScanRow {
  return {
    source: "checklist",
    id: "d1",
    firm_id: "f1",
    client_id: "c1",
    name: "T4 - 2024 - Employer.pdf",
    ai_doc_type: "t4",
    ai_confidence: 0.95,
    manual_doc_type: null,
    browse_year: 2024,
    browse_category: "federal_slips",
    folder_id: null,
    content_hash: null,
    created_at: "2026-07-01T00:00:00Z",
    ...over,
  };
}

describe("categoryMisfile", () => {
  it("flags a trusted type sitting in the wrong category", () => {
    const r = row({ browse_category: "invoices" });
    const fix = categoryMisfile(r);
    expect(fix).not.toBeNull();
    expect(fix!.category).not.toBe("invoices");
  });

  it("stays quiet when the category already matches the type", () => {
    const r = row();
    const expected = categoryMisfile(row({ browse_category: "invoices" }))!.category;
    expect(categoryMisfile(row({ browse_category: expected }))).toBeNull();
  });

  it("stays quiet when there is no trusted type at all", () => {
    expect(
      categoryMisfile(row({ ai_doc_type: null, browse_category: "invoices" })),
    ).toBeNull();
  });
});

describe("duplicateSuggestions", () => {
  it("keeps the newest copy and proposes deleting the rest", () => {
    const old1 = row({ id: "a", content_hash: "h1", created_at: "2026-01-01T00:00:00Z" });
    const old2 = row({ id: "b", content_hash: "h1", created_at: "2026-02-01T00:00:00Z" });
    const newest = row({ id: "c", content_hash: "h1", created_at: "2026-03-01T00:00:00Z" });
    const out = duplicateSuggestions([old1, newest, old2]);
    expect(out.map((s) => s.document_id).sort()).toEqual(["a", "b"]);
    for (const s of out) {
      expect(s.keep_document_id).toBe("c");
      expect(s.bucket).toBe("duplicate");
    }
  });

  it("same hash for DIFFERENT clients is not a duplicate", () => {
    const a = row({ id: "a", content_hash: "h1", client_id: "c1" });
    const b = row({ id: "b", content_hash: "h1", client_id: "c2" });
    expect(duplicateSuggestions([a, b])).toEqual([]);
  });

  it("missing hashes never group", () => {
    const a = row({ id: "a", content_hash: null });
    const b = row({ id: "b", content_hash: null });
    expect(duplicateSuggestions([a, b])).toEqual([]);
  });
});

describe("lunaCandidates", () => {
  const now = new Date("2026-08-01T12:00:00Z").getTime();

  it("a hand-typed document is never a candidate — a human already answered", () => {
    const r = row({ manual_doc_type: "t4", ai_doc_type: null });
    const { unprocessed, lowConfidence } = lunaCandidates([r], now);
    expect(unprocessed).toEqual([]);
    expect(lowConfidence).toEqual([]);
  });

  it("an un-analyzed upload counts as unprocessed only past the freshness window", () => {
    const fresh = row({ ai_doc_type: null, created_at: "2026-08-01T11:59:00Z" });
    const stale = row({ id: "d2", ai_doc_type: null, created_at: "2026-08-01T00:00:00Z" });
    const { unprocessed } = lunaCandidates([fresh, stale], now);
    expect(unprocessed.map((r) => r.id)).toEqual(["d2"]);
  });

  it("low confidence goes to the low_confidence pool, at the documented threshold", () => {
    const low = row({ id: "lo", ai_confidence: LOW_CONFIDENCE_THRESHOLD - 0.01 });
    const high = row({ id: "hi", ai_confidence: LOW_CONFIDENCE_THRESHOLD });
    const { lowConfidence } = lunaCandidates([low, high], now);
    expect(lowConfidence.map((r) => r.id)).toEqual(["lo"]);
  });

  it("imports with no hand-set type are Luna candidates — names are fair game", () => {
    const imp = row({ source: "imported", ai_doc_type: null });
    const { unprocessed } = lunaCandidates([imp], now);
    expect(unprocessed.map((r) => r.id)).toEqual(["d1"]);
  });
});

describe("proposalsToSuggestions", () => {
  const r = row({ ai_doc_type: null, ai_confidence: null });
  const byId = new Map([[`checklist:${r.id}`, { row: r, bucket: "unprocessed" as const }]]);

  it("null doc_type from Luna means NO suggestion — never a guess", () => {
    const out = proposalsToSuggestions(
      [{ id: "checklist:d1", doc_type: null, year: null, reason: "unclear" }],
      byId,
    );
    expect(out).toEqual([]);
  });

  it("an invented code outside the registry is dropped", () => {
    const out = proposalsToSuggestions(
      [{ id: "checklist:d1", doc_type: "made_up_code", year: null, reason: "x" }],
      byId,
    );
    expect(out).toEqual([]);
  });

  it("a year alone (no type) becomes a misfile proposal when it differs", () => {
    const out = proposalsToSuggestions(
      [{ id: "checklist:d1", doc_type: null, year: 2025, reason: "name says 2025" }],
      byId,
    );
    expect(out).toHaveLength(1);
    expect(out[0].bucket).toBe("misfile");
    expect(out[0].proposed_state).toEqual({ year: 2025 });
  });

  it("an absurd year is rejected", () => {
    const out = proposalsToSuggestions(
      [{ id: "checklist:d1", doc_type: null, year: 224, reason: "typo" }],
      byId,
    );
    expect(out).toEqual([]);
  });
});

describe("stateMatches — the staleness fingerprint", () => {
  it("matches the exact state it was built from", () => {
    const r = row();
    expect(stateMatches(stateOf(r), r)).toBe(true);
  });

  it("any drift — rename, re-file, re-type — breaks the match", () => {
    const r = row();
    const s = stateOf(r);
    expect(stateMatches(s, row({ name: "renamed.pdf" }))).toBe(false);
    expect(stateMatches(s, row({ browse_year: 2023 }))).toBe(false);
    expect(stateMatches(s, row({ folder_id: "f-new" }))).toBe(false);
    expect(stateMatches(s, row({ manual_doc_type: "rl1" }))).toBe(false);
  });

  it("garbage stored state never matches", () => {
    expect(stateMatches(null, row())).toBe(false);
    expect(stateMatches("x", row())).toBe(false);
  });
});
