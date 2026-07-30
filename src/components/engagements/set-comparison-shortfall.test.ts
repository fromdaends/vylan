import { describe, it, expect } from "vitest";
import {
  setComparisonShortfall,
  shouldShowSetLine,
} from "./set-summary-line";
import type { SetAssessment } from "@/lib/ai/set-assessment";

// The cross-file check carries at most MAX_SET_FILES files in one pass. When a
// client dumps a hundred documents onto one checklist line, only the first
// batch gets compared against each other — every file is still read on its own,
// but missing pages and broken balances can hide among the ones that were never
// compared.
//
// That shortfall WAS recorded, in flags[], which nothing on the engagement page
// renders. So comparing 16 of 100 files looked exactly like comparing all 100.

const base = (over: Partial<SetAssessment> = {}): SetAssessment =>
  ({
    conclusion_en: "The four pages are present.",
    conclusion_fr: "Les quatre pages sont présentes.",
    confidence: 0.9,
    outcome: "complete",
    client_request_en: "",
    client_request_fr: "",
    pages: [],
    flags: [],
    assessed_at: "2026-07-30T15:00:00Z",
    files_signature: [],
    ...over,
  }) as SetAssessment;

describe("setComparisonShortfall", () => {
  it("reports the shortfall when not every file was compared", () => {
    expect(
      setComparisonShortfall(
        base({ reviewed_file_count: 16, total_file_count: 100 }),
      ),
    ).toEqual({ reviewed: 16, total: 100 });
  });

  it("is silent when the check covered everything", () => {
    expect(
      setComparisonShortfall(
        base({ reviewed_file_count: 4, total_file_count: 4 }),
      ),
    ).toBeNull();
  });

  // Assessments written before these counts existed must not sprout a warning.
  it("is silent when the counts are absent", () => {
    expect(setComparisonShortfall(base())).toBeNull();
  });

  it("is silent on nonsense rather than inventing a warning", () => {
    expect(
      setComparisonShortfall(
        base({ reviewed_file_count: 10, total_file_count: 4 }),
      ),
    ).toBeNull();
    expect(
      setComparisonShortfall(
        base({ reviewed_file_count: -1, total_file_count: 4 }),
      ),
    ).toBeNull();
    expect(
      setComparisonShortfall(
        base({
          reviewed_file_count: Number.NaN,
          total_file_count: 100,
        }),
      ),
    ).toBeNull();
  });
});

describe("shouldShowSetLine — a partial comparison must never stay quiet", () => {
  // Without this the 100-document case shows NOTHING: outcome "complete",
  // no chain findings, so the old rule had nothing to display and the
  // accountant would never learn only 16 were compared.
  it("shows the line for a shortfall even when nothing else warrants one", () => {
    expect(
      shouldShowSetLine(
        base({
          outcome: "complete",
          reviewed_file_count: 16,
          total_file_count: 100,
        }),
        100,
      ),
    ).toBe(true);
  });

  it("still adds nothing for a clean, fully-compared single file", () => {
    expect(
      shouldShowSetLine(
        base({
          outcome: "complete",
          reviewed_file_count: 1,
          total_file_count: 1,
        }),
        1,
      ),
    ).toBe(false);
  });

  it("is unchanged for a normal multi-file set", () => {
    expect(
      shouldShowSetLine(
        base({ reviewed_file_count: 3, total_file_count: 3 }),
        3,
      ),
    ).toBe(true);
  });
});
