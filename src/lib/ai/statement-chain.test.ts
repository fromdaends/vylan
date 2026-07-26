import { describe, it, expect } from "vitest";
import {
  analyzeStatements,
  normalizeAccountRef,
  parseExtractedStatements,
  type ExtractedStatement,
} from "./statement-chain";

// Builder for a monthly statement. Cycle Apr 27 – May 26 style (the founder's
// real Scotiabank cycle) so nothing here assumes calendar months.
function st(o: Partial<ExtractedStatement>): ExtractedStatement {
  return {
    file_id: "f1",
    account_ref: "21691 09441 22",
    period_start: null,
    period_end: null,
    opening_balance: null,
    closing_balance: null,
    ...o,
  };
}

describe("normalizeAccountRef", () => {
  it("keeps digits only and rejects refs with too few to identify anything", () => {
    expect(normalizeAccountRef("21691 09441 22")).toBe("216910944122");
    expect(normalizeAccountRef("****4821")).toBe("4821");
    expect(normalizeAccountRef("⋯4821")).toBe("4821");
    expect(normalizeAccountRef("no digits")).toBeNull();
    expect(normalizeAccountRef("12")).toBeNull();
    expect(normalizeAccountRef(null)).toBeNull();
  });
});

describe("analyzeStatements — chaining", () => {
  const jan = st({
    period_start: "2026-01-27",
    period_end: "2026-02-26",
    opening_balance: 1204.5,
    closing_balance: 891.11,
  });
  const feb = st({
    period_start: "2026-02-27",
    period_end: "2026-03-26",
    opening_balance: 891.11,
    closing_balance: -40.25, // overdraft — negatives must chain too
  });
  const mar = st({
    period_start: "2026-03-27",
    period_end: "2026-04-26",
    opening_balance: -40.25,
    closing_balance: 310.0,
  });

  it("a clean chained run produces no findings and one coverage line", () => {
    const { findings, coverage } = analyzeStatements([jan, feb, mar]);
    expect(findings).toEqual([]);
    expect(coverage).toHaveLength(1);
    expect(coverage[0]!.statements).toBe(3);
    expect(coverage[0]!.text_en).toContain("no gaps");
    expect(coverage[0]!.text_fr).toContain("sans trou");
    expect(coverage[0]!.text_en).toContain("⋯4122"); // short ref, never the full number
  });

  it("sort order does not depend on input order", () => {
    const { findings } = analyzeStatements([mar, jan, feb]);
    expect(findings).toEqual([]);
  });

  it("reports a missing statement as a GAP with the uncovered span", () => {
    // Jan and Mar present, Feb missing — the founder's 'April is missing' case,
    // cycle-aware.
    const { findings, coverage } = analyzeStatements([jan, mar]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("gap");
    expect(findings[0]!.text_en).toMatch(/missing between .*Feb 26, 2026.* and .*Mar 27, 2026/);
    expect(findings[0]!.text_en).toContain("about 1 month");
    expect(findings[0]!.text_fr).toContain("environ 1 mois");
    expect(coverage[0]!.text_en).toContain("1 gap");
  });

  it("never double-reports a balance break across a gap seam", () => {
    // Balances legitimately differ across the hole — only the gap may fire.
    const { findings } = analyzeStatements([jan, mar]);
    expect(findings.every((f) => f.kind === "gap")).toBe(true);
  });

  it("reports a balance break to the cent, on adjacent statements only", () => {
    const brokenFeb = st({
      ...feb,
      opening_balance: 891.12, // one cent off
    });
    const { findings } = analyzeStatements([jan, brokenFeb]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("balance_break");
    expect(findings[0]!.delta_cents).toBe(1);
    expect(findings[0]!.text_en).toContain("$891.11");
    expect(findings[0]!.text_en).toContain("$891.12");
  });

  it("compares in integer cents so float artifacts cannot fire", () => {
    // 0.1 + 0.2 === 0.30000000000000004 — must still chain.
    const a = st({
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      closing_balance: 0.1 + 0.2,
    });
    const b = st({
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      opening_balance: 0.3,
    });
    expect(analyzeStatements([a, b]).findings).toEqual([]);
  });

  it("tolerates a few days of cycle drift without calling it a gap", () => {
    const drift = st({
      period_start: "2026-03-02", // 4 uncovered days after Feb 26 — grace
      period_end: "2026-04-01",
      opening_balance: -40.25,
    });
    const base = { ...feb, closing_balance: -40.25 };
    expect(analyzeStatements([st(base), drift]).findings).toEqual([]);
  });
});

describe("analyzeStatements — guards (false alarms are the enemy)", () => {
  it("a null balance can never manufacture a break", () => {
    const a = st({
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      closing_balance: null,
    });
    const b = st({
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      opening_balance: 500,
    });
    expect(analyzeStatements([a, b]).findings).toEqual([]);
  });

  it("a statement missing a period date is excluded entirely", () => {
    const a = st({ period_start: "2026-01-01", period_end: null });
    const b = st({ period_start: "2026-05-01", period_end: "2026-05-31" });
    expect(analyzeStatements([a, b]).findings).toEqual([]);
  });

  it("two accounts never chain against each other", () => {
    const chq1 = st({
      account_ref: "1111 2222 4821",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      closing_balance: 100,
    });
    const sav1 = st({
      account_ref: "9999 8888 9930",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      closing_balance: 5000,
    });
    const chq2 = st({
      account_ref: "1111 2222 4821",
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      opening_balance: 100,
    });
    const sav2 = st({
      account_ref: "9999 8888 9930",
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      opening_balance: 5000,
    });
    const { findings, coverage } = analyzeStatements([chq1, sav1, chq2, sav2]);
    expect(findings).toEqual([]);
    expect(coverage).toHaveLength(2); // one line per account
  });

  it("merges a masked ref with its full form into one account", () => {
    const full = st({
      account_ref: "21691 09441 4821",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      closing_balance: 100,
    });
    const masked = st({
      account_ref: "****4821",
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      opening_balance: 250, // real break — must be DETECTED, proving the merge
    });
    const { findings } = analyzeStatements([full, masked]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("balance_break");
  });

  it("skips an unidentified bucket whose periods overlap (likely two accounts)", () => {
    const a = st({
      account_ref: null,
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      closing_balance: 100,
    });
    const b = st({
      account_ref: null,
      period_start: "2026-01-15", // overlaps a — no refs, no way to be sure
      period_end: "2026-02-14",
      opening_balance: 999,
    });
    const { findings, coverage } = analyzeStatements([a, b]);
    expect(findings).toEqual([]);
    expect(coverage).toEqual([]);
  });

  it("still chains an unidentified bucket with clean consecutive periods", () => {
    const a = st({
      account_ref: null,
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      closing_balance: 100,
    });
    const b = st({
      account_ref: null,
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      opening_balance: 90,
    });
    const { findings } = analyzeStatements([a, b]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.delta_cents).toBe(-1000);
  });

  it("fewer than two usable statements yields nothing at all", () => {
    expect(analyzeStatements([]).findings).toEqual([]);
    expect(
      analyzeStatements([st({ period_start: "2026-01-01", period_end: "2026-01-31" })])
        .findings,
    ).toEqual([]);
  });
});

describe("parseExtractedStatements", () => {
  it("anchors image_index to file ids and validates every field", () => {
    const out = parseExtractedStatements(
      [
        {
          image_index: 2,
          account_ref: "  ⋯4821 ",
          period_start: "2026-01-27",
          period_end: "2026-02-26",
          opening_balance: 10.5,
          closing_balance: 20.75,
        },
      ],
      ["fileA", "fileB"],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      file_id: "fileB",
      account_ref: "⋯4821",
      opening_balance: 10.5,
    });
  });

  it("nulls non-ISO dates and non-finite numbers instead of trusting them", () => {
    const out = parseExtractedStatements(
      [
        {
          image_index: 1,
          account_ref: "x",
          period_start: "May 26, 2026",
          period_end: "2026-05-26",
          opening_balance: "1,234.56",
          closing_balance: Infinity,
        },
      ],
      ["fileA"],
    );
    expect(out[0]!.period_start).toBeNull();
    expect(out[0]!.period_end).toBe("2026-05-26");
    expect(out[0]!.opening_balance).toBeNull();
    expect(out[0]!.closing_balance).toBeNull();
  });

  it("drops junk shapes and out-of-range indexes without throwing", () => {
    const out = parseExtractedStatements(
      [null, "junk", { image_index: 99 }, { image_index: 0 }],
      ["fileA"],
    );
    // Junk entries survive only as null-anchored rows when object-shaped;
    // non-objects are dropped.
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.file_id === null)).toBe(true);
    expect(parseExtractedStatements("not an array", ["fileA"])).toEqual([]);
  });
});
