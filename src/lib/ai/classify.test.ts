import { describe, it, expect } from "vitest";
import { parseClassification } from "./classify";
import { USABLE_BY_DEFAULT } from "./usability";

describe("parseClassification", () => {
  it("returns a complete result for valid input", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.92,
      extracted_year: 2024,
      extracted_amount_or_total: 52140,
      looks_correct: true,
      issue_if_any: null,
      usable: true,
      usability_confidence: 0.96,
      primary_issue: null,
      all_issues: [],
      issue_summary_fr: "",
      issue_summary_en: "",
    });
    expect(out).toEqual({
      document_type: "t4",
      confidence: 0.92,
      reasoning: "",
      key_identifiers: [],
      second_guess: null,
      extracted_year: 2024,
      extracted_amount_or_total: 52140,
      document_date: null,
      issuer_name: null,
      party_name: null,
      account_or_period: null,
      form_identifier: null,
      amounts: [],
      fields_confidence: 0,
      looks_correct: true,
      issue_if_any: null,
      usability: {
        usable: true,
        confidence: 0.96,
        primary_issue: null,
        all_issues: [],
        issue_summary_fr: "",
        issue_summary_en: "",
      },
    });
  });

  it("collapses unknown document_type to 'unknown'", () => {
    const out = parseClassification({
      document_type: "made_up_thing",
      confidence: 0.4,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: false,
      issue_if_any: "Could not identify",
    });
    expect(out?.document_type).toBe("unknown");
  });

  it("clamps confidence into [0,1]", () => {
    const lo = parseClassification({
      document_type: "t4",
      confidence: -0.3,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: false,
      issue_if_any: null,
    });
    expect(lo?.confidence).toBe(0);
    const hi = parseClassification({
      document_type: "t4",
      confidence: 2.5,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(hi?.confidence).toBe(1);
  });

  it("nulls out missing or wrong-typed numeric fields", () => {
    const out = parseClassification({
      document_type: "rl1",
      confidence: 0.7,
      extracted_year: "twenty-twenty-four",
      extracted_amount_or_total: "$52,140",
      looks_correct: true,
      issue_if_any: null,
    });
    expect(out?.extracted_year).toBeNull();
    expect(out?.extracted_amount_or_total).toBeNull();
  });

  it("trims and normalizes empty issue_if_any to null", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.95,
      extracted_year: 2024,
      extracted_amount_or_total: 50000,
      looks_correct: true,
      issue_if_any: "   ",
    });
    expect(out?.issue_if_any).toBeNull();
  });

  it("returns null for malformed input (missing required fields)", () => {
    expect(parseClassification({})).toBeNull();
    expect(
      parseClassification({ document_type: "t4" }),
    ).toBeNull();
  });

  it("defaults usability to the safe state when usable / usability_confidence are absent", () => {
    // Older tool responses won't have the new fields. Fail-safe so a
    // legacy / hesitant AI never auto-rejects a clean file.
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: 2024,
      extracted_amount_or_total: 1000,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(out?.usability).toEqual(USABLE_BY_DEFAULT);
  });

  it("captures an unusable verdict with all the bilingual reason fields", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: 0.91,
      primary_issue: "partial_capture",
      all_issues: ["partial_capture", "glare_or_shadow"],
      issue_summary_fr: "Le côté droit du document est coupé.",
      issue_summary_en: "The right side of the document is cut off.",
    });
    expect(out?.usability).toEqual({
      usable: false,
      confidence: 0.91,
      primary_issue: "partial_capture",
      all_issues: ["partial_capture", "glare_or_shadow"],
      issue_summary_fr: "Le côté droit du document est coupé.",
      issue_summary_en: "The right side of the document is cut off.",
    });
  });

  it("drops unknown issue values from all_issues + nulls an invalid primary_issue", () => {
    // The model can occasionally hallucinate an enum value. Filter
    // unknowns rather than rejecting the whole assessment.
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: 0.85,
      primary_issue: "low_resolution",
      all_issues: ["low_resolution", "text_unreadable", "smudged"],
      issue_summary_fr: "Image floue.",
      issue_summary_en: "Image is blurry.",
    });
    expect(out?.usability.primary_issue).toBeNull();
    expect(out?.usability.all_issues).toEqual(["text_unreadable"]);
  });

  it("accepts t1135 and t2125 as valid document_type values", () => {
    const t1135 = parseClassification({
      document_type: "t1135",
      confidence: 0.88,
      extracted_year: 2024,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(t1135?.document_type).toBe("t1135");

    const t2125 = parseClassification({
      document_type: "t2125",
      confidence: 0.91,
      extracted_year: 2024,
      extracted_amount_or_total: 42500,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(t2125?.document_type).toBe("t2125");
  });

  it("clamps usability_confidence into [0,1]", () => {
    const hi = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: 1.5,
      primary_issue: "text_unreadable",
      all_issues: ["text_unreadable"],
      issue_summary_fr: "x",
      issue_summary_en: "y",
    });
    expect(hi?.usability.confidence).toBe(1);

    const lo = parseClassification({
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
      usable: false,
      usability_confidence: -0.2,
      primary_issue: "text_unreadable",
      all_issues: ["text_unreadable"],
      issue_summary_fr: "x",
      issue_summary_en: "y",
    });
    expect(lo?.usability.confidence).toBe(0);
  });

  it("captures reasoning, key_identifiers, and a second guess when provided", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.6,
      reasoning: "title reads 'T4 Statement of Remuneration Paid'",
      key_identifiers: ["T4", "Statement of Remuneration Paid", "  "],
      second_guess_type: "t4a",
      second_guess_confidence: 0.3,
      extracted_year: 2024,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
    });
    expect(out?.reasoning).toBe(
      "title reads 'T4 Statement of Remuneration Paid'",
    );
    // blank entries dropped + values trimmed
    expect(out?.key_identifiers).toEqual([
      "T4",
      "Statement of Remuneration Paid",
    ]);
    expect(out?.second_guess).toEqual({ document_type: "t4a", confidence: 0.3 });
  });

  it("drops a second guess that is 'unknown', unrecognized, or missing its confidence", () => {
    const base = {
      document_type: "t4",
      confidence: 0.9,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: true,
      issue_if_any: null,
    };
    expect(
      parseClassification({
        ...base,
        second_guess_type: "unknown",
        second_guess_confidence: 0.3,
      })?.second_guess,
    ).toBeNull();
    expect(
      parseClassification({
        ...base,
        second_guess_type: "made_up",
        second_guess_confidence: 0.3,
      })?.second_guess,
    ).toBeNull();
    expect(
      parseClassification({
        ...base,
        second_guess_type: "t4a",
        second_guess_confidence: null,
      })?.second_guess,
    ).toBeNull();
  });

  it("extracts and normalizes the Phase 3 key fields + caps amounts at 5", () => {
    const out = parseClassification({
      document_type: "t4",
      confidence: 0.95,
      extracted_year: 2024,
      extracted_amount_or_total: 52140,
      document_date: "2025-02-28",
      issuer_name: "  Acme Corp  ",
      party_name: "Jane Doe",
      account_or_period: "",
      form_identifier: "T4",
      fields_confidence: 0.8,
      amounts: [
        { label: " Box 14 ", value: 52140 },
        { label: "Box 22", value: 8200 },
        { label: "no value" },
        { label: 99, value: 1 },
        { label: "a", value: 1 },
        { label: "b", value: 2 },
        { label: "c", value: 3 },
        { label: "d", value: 4 },
      ],
      looks_correct: true,
      issue_if_any: null,
    });
    expect(out?.document_date).toBe("2025-02-28");
    expect(out?.issuer_name).toBe("Acme Corp");
    expect(out?.party_name).toBe("Jane Doe");
    expect(out?.account_or_period).toBeNull(); // empty string -> null
    expect(out?.form_identifier).toBe("T4");
    expect(out?.fields_confidence).toBe(0.8);
    // malformed rows dropped, labels trimmed, capped at 5
    expect(out?.amounts).toEqual([
      { label: "Box 14", value: 52140 },
      { label: "Box 22", value: 8200 },
      { label: "a", value: 1 },
      { label: "b", value: 2 },
      { label: "c", value: 3 },
    ]);
  });
});

describe("parseClassification — unreadable owner rule", () => {
  const base = {
    document_type: "t4",
    confidence: 0.95,
    extracted_year: 2024,
    extracted_amount_or_total: 14650,
    looks_correct: true,
    issue_if_any: null,
  };

  it("forces an unusable verdict when owner_identifiable is false", () => {
    const out = parseClassification({
      ...base,
      party_name: "(name visible but redacted)",
      owner_identifiable: false,
      usable: true,
      usability_confidence: 0.9,
      primary_issue: null,
      all_issues: [],
      issue_summary_fr: "",
      issue_summary_en: "",
    });
    expect(out?.usability.usable).toBe(false);
    expect(out?.usability.primary_issue).toBe("key_fields_obscured");
    expect(out?.usability.all_issues).toContain("key_fields_obscured");
    // surfaced above the 0.80 auto-act threshold so it routes for rejection
    expect(out?.usability.confidence).toBeGreaterThanOrEqual(0.85);
    // a client-facing message is always present
    expect(out?.usability.issue_summary_en).not.toBe("");
    expect(out?.usability.issue_summary_fr).not.toBe("");
  });

  it("drops a 'redacted' placeholder name to null when the owner is unreadable", () => {
    const out = parseClassification({
      ...base,
      party_name: "(Employee name visible but redacted)",
      owner_identifiable: false,
      usable: true,
      usability_confidence: 0.9,
    });
    expect(out?.party_name).toBeNull();
  });

  it("keeps a worse primary issue but still adds key_fields_obscured", () => {
    const out = parseClassification({
      ...base,
      owner_identifiable: false,
      usable: false,
      usability_confidence: 0.95,
      primary_issue: "text_unreadable",
      all_issues: ["text_unreadable"],
      issue_summary_en: "Too blurry to read.",
      issue_summary_fr: "Trop floue.",
    });
    expect(out?.usability.usable).toBe(false);
    expect(out?.usability.primary_issue).toBe("text_unreadable");
    expect(out?.usability.all_issues).toEqual(
      expect.arrayContaining(["text_unreadable", "key_fields_obscured"]),
    );
    // an existing client message is preserved, not overwritten
    expect(out?.usability.issue_summary_en).toBe("Too blurry to read.");
  });

  it("leaves the verdict untouched when the owner IS identifiable", () => {
    const out = parseClassification({
      ...base,
      party_name: "Mahdi Ebrahimi",
      owner_identifiable: true,
      usable: true,
      usability_confidence: 0.9,
      primary_issue: null,
      all_issues: [],
      issue_summary_fr: "",
      issue_summary_en: "",
    });
    expect(out?.usability.usable).toBe(true);
    expect(out?.party_name).toBe("Mahdi Ebrahimi");
  });

  it("does not over-reject when owner_identifiable is absent (fail-safe)", () => {
    const out = parseClassification({
      ...base,
      party_name: "Sarah Fielding",
      usable: true,
      usability_confidence: 0.9,
    });
    expect(out?.usability.usable).toBe(true);
    expect(out?.party_name).toBe("Sarah Fielding");
  });
});
