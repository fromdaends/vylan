import { describe, it, expect } from "vitest";
import {
  parseClassification,
  normalizeMimeType,
  isSupportedAiMime,
  buildSystemPrompt,
} from "./classify";
import { USABLE_BY_DEFAULT } from "./usability";

describe("buildSystemPrompt — the request in words", () => {
  it("names the requested item, client, and year so wrong uploads can bounce", () => {
    const p = buildSystemPrompt("other", {
      requestLabel: "Void cheque (direct deposit)",
      requestLabelFr: "Spécimen de chèque (dépôt direct)",
      clientName: "Zachary Thresh",
      expectedYear: 2026,
    });
    expect(p).toContain('asked the client for: "Void cheque (direct deposit)"');
    expect(p).toContain("Spécimen de chèque");
    expect(p).toContain("Zachary Thresh");
    expect(p).toContain("tax year 2026");
    // For free-form items the doc-type code carries no meaning — the prompt
    // must steer the model to the wording, not the code.
    expect(p).toContain("judge the upload against the request wording");
  });

  it("still includes the type code for typed items", () => {
    const p = buildSystemPrompt("t4", {
      requestLabel: "T4 slip",
    });
    expect(p).toContain('expected document type code is "t4"');
  });

  it("includes the accountant's per-item note when set, as advisory guidance", () => {
    const p = buildSystemPrompt("other", {
      requestLabel: "T1 return",
      aiInstructions: "expect a 2024 return, not 2026",
    });
    expect(p).toContain('"expect a 2024 return, not 2026"');
    expect(p).toContain("note about what to expect");
    // Advisory, never an override of the safety checks.
    expect(p).toContain("NOT a licence to accept");
  });

  it("leaves the prompt byte-identical when the note is blank/undefined (default behavior)", () => {
    const base = buildSystemPrompt("other", { requestLabel: "T1 return" });
    expect(
      buildSystemPrompt("other", { requestLabel: "T1 return", aiInstructions: null }),
    ).toBe(base);
    expect(
      buildSystemPrompt("other", { requestLabel: "T1 return", aiInstructions: "   " }),
    ).toBe(base);
  });

  it("falls back to the legacy code-only phrasing without context", () => {
    const p = buildSystemPrompt("other");
    expect(p).toContain('The accountant requested a "other" document.');
  });

  it("guards against false bounces on family names and older years", () => {
    const p = buildSystemPrompt("other", { requestLabel: "X" });
    expect(p).toContain("NOT, by itself,\n    wrong_document_type");
    expect(p).toContain("dependants");
    expect(p).toContain("older tax year is NOT");
  });

  it("instructs the model to weigh belongs_to_client holistically and score overall", () => {
    const p = buildSystemPrompt("t2125", {
      requestLabel: "Business income (T2125)",
      clientName: "Tyler Jette",
    });
    expect(p).toContain("belongs_to_client");
    expect(p).toContain("OVERALL SCORE");
    // a business name must be explicitly called out as NOT automatically a stranger
    expect(p).toMatch(/business/i);
    expect(p).toContain("Tyler Jette");
  });

  it("treats PARTIAL obscuring of a key number as disqualifying", () => {
    const p = buildSystemPrompt("other", {
      requestLabel: "Void cheque (direct deposit)",
    });
    // The transit-scribble case: one struck digit must obscure the whole number.
    expect(p).toContain("PARTIAL obscuring");
    // \s+ not a literal space: the prompt wraps "SINGLE\ndigit" across a line.
    expect(p).toMatch(/single\s+digit/i);
    expect(p).toContain("Do NOT infer, guess, or reconstruct");
    // ...but the VOID stamp / logo / signature must NOT trip it.
    expect(p).toMatch(/VOID/);
    expect(p).toContain("EXPECTED printed elements are NOT redactions");
  });
});

describe("normalizeMimeType / isSupportedAiMime", () => {
  it("strips charset params, trims, and lowercases", () => {
    expect(normalizeMimeType("application/pdf; charset=binary")).toBe(
      "application/pdf",
    );
    expect(normalizeMimeType("IMAGE/JPEG")).toBe("image/jpeg");
    expect(normalizeMimeType("  application/pdf  ")).toBe("application/pdf");
  });

  it("treats PDFs and images (including charset-tagged) as AI-readable", () => {
    expect(isSupportedAiMime("application/pdf")).toBe(true);
    expect(isSupportedAiMime("application/pdf; charset=binary")).toBe(true);
    expect(isSupportedAiMime("image/jpeg")).toBe(true);
    expect(isSupportedAiMime("image/webp")).toBe(true);
    expect(isSupportedAiMime("image/heic")).toBe(true);
  });

  it("rejects the octet-stream fallback that made PDFs skip the AI check", () => {
    expect(isSupportedAiMime("application/octet-stream")).toBe(false);
    expect(isSupportedAiMime("binary/octet-stream")).toBe(false);
    expect(isSupportedAiMime("text/plain")).toBe(false);
    expect(isSupportedAiMime("")).toBe(false);
  });
});

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
      belongs_to_client: null,
      belongs_confidence: 0,
      overall_confidence: 0.92,
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

describe("parseClassification — obscured key-values rule", () => {
  const base = {
    document_type: "other",
    confidence: 0.95,
    extracted_year: null,
    extracted_amount_or_total: null,
    looks_correct: true,
    issue_if_any: null,
    party_name: "Zachary Thresh",
    owner_identifiable: true,
  };

  it("forces an unusable verdict when the key numbers are blacked out (the void-cheque case)", () => {
    // The exact failure: a clean void cheque whose account number is scribbled
    // out — owner readable, quality 'looks good', but key_values_obscured.
    const out = parseClassification({
      ...base,
      key_values_obscured: true,
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
    // above the 0.80 auto-act threshold so it auto-bounces to the client
    expect(out?.usability.confidence).toBeGreaterThanOrEqual(0.85);
    // a client-facing message is always present, about the numbers (no jargon)
    expect(out?.usability.issue_summary_en).toMatch(/numbers/i);
    expect(out?.usability.issue_summary_fr).not.toBe("");
  });

  it("keeps a worse primary issue but still adds key_fields_obscured", () => {
    const out = parseClassification({
      ...base,
      key_values_obscured: true,
      usable: false,
      usability_confidence: 0.95,
      primary_issue: "text_unreadable",
      all_issues: ["text_unreadable"],
      issue_summary_en: "Too blurry to read.",
      issue_summary_fr: "Trop floue.",
    });
    expect(out?.usability.primary_issue).toBe("text_unreadable");
    expect(out?.usability.all_issues).toEqual(
      expect.arrayContaining(["text_unreadable", "key_fields_obscured"]),
    );
    // an existing client message is preserved, not overwritten
    expect(out?.usability.issue_summary_en).toBe("Too blurry to read.");
  });

  it("leaves the verdict untouched when key values are readable", () => {
    const out = parseClassification({
      ...base,
      key_values_obscured: false,
      usable: true,
      usability_confidence: 0.9,
      primary_issue: null,
      all_issues: [],
      issue_summary_fr: "",
      issue_summary_en: "",
    });
    expect(out?.usability.usable).toBe(true);
  });

  it("does not over-reject when the signal is absent (fail-safe)", () => {
    const out = parseClassification({
      ...base,
      usable: true,
      usability_confidence: 0.9,
    });
    expect(out?.usability.usable).toBe(true);
  });

  it("rejects when no owner name is extracted, even if owner_identifiable is true", () => {
    // The model can contradict itself — claim the owner is identifiable while
    // leaving party_name blank (seen on a Sample-Company trial balance). A
    // missing name is ground truth: there's nobody to confirm the doc by.
    const out = parseClassification({
      ...base,
      document_type: "trial_balance",
      party_name: null,
      owner_identifiable: true,
      usable: true,
      usability_confidence: 0.9,
      primary_issue: null,
      all_issues: [],
      issue_summary_fr: "",
      issue_summary_en: "",
    });
    expect(out?.usability.usable).toBe(false);
    expect(out?.usability.primary_issue).toBe("key_fields_obscured");
    expect(out?.party_name).toBeNull();
  });

  it("rejects when party_name is empty/whitespace and the owner signal is present", () => {
    const out = parseClassification({
      ...base,
      party_name: "   ",
      owner_identifiable: true,
      usable: true,
      usability_confidence: 0.9,
    });
    expect(out?.usability.usable).toBe(false);
  });
});

describe("parseClassification — belongs_to_client + overall_confidence", () => {
  const base = {
    document_type: "t4",
    confidence: 0.99,
    extracted_year: 2024,
    extracted_amount_or_total: 50000,
    looks_correct: true,
    issue_if_any: null,
    party_name: "Jane Smith",
    owner_identifiable: true,
    usable: true,
    usability_confidence: 0.95,
    primary_issue: null,
    all_issues: [],
    issue_summary_fr: "",
    issue_summary_en: "",
  };

  it("parses belongs fields; overall_confidence falls back to type confidence when absent", () => {
    const out = parseClassification({ ...base });
    expect(out?.belongs_to_client).toBeNull();
    expect(out?.belongs_confidence).toBe(0);
    expect(out?.overall_confidence).toBe(0.99); // fell back to confidence
  });

  it("keeps an explicit overall_confidence (clamped), distinct from type confidence", () => {
    expect(parseClassification({ ...base, overall_confidence: 0.12 })?.overall_confidence).toBe(0.12);
    expect(parseClassification({ ...base, overall_confidence: 1.4 })?.overall_confidence).toBe(1);
  });

  it("HARD-REJECTS a document the model is confident belongs to someone else", () => {
    // The smart-identity case: a clean, readable, right-TYPE T4 the model judged
    // (holistically) belongs to an unrelated person. usable flips to false with
    // wrong_document_type so it routes like any other reject.
    const out = parseClassification({
      ...base,
      belongs_to_client: false,
      belongs_confidence: 0.92,
      issue_summary_en: "This looks like someone else's T4.",
      issue_summary_fr: "Ceci semble être le T4 d'une autre personne.",
    });
    expect(out?.usability.usable).toBe(false);
    expect(out?.usability.primary_issue).toBe("wrong_document_type");
    expect(out?.usability.all_issues).toContain("wrong_document_type");
    expect(out?.usability.confidence).toBeGreaterThanOrEqual(0.85);
    expect(out?.usability.issue_summary_en).toContain("someone else");
  });

  it("does NOT bounce a business name the model is UNSURE about (< 0.80) — the false-bounce fix", () => {
    // "Smith Plumbing Inc." for client Tyler Jette: the model suspects but isn't
    // sure → stays usable, accountant reviews, client is never nagged.
    const out = parseClassification({
      ...base,
      document_type: "t2125",
      party_name: "Smith Plumbing Inc.",
      belongs_to_client: false,
      belongs_confidence: 0.55,
    });
    expect(out?.usability.usable).toBe(true);
  });

  it("does NOT bounce a document the model says DOES belong to the client", () => {
    const out = parseClassification({
      ...base,
      document_type: "t2125",
      party_name: "Smith Plumbing Inc.",
      belongs_to_client: true,
      belongs_confidence: 0.9,
    });
    expect(out?.usability.usable).toBe(true);
    expect(out?.belongs_to_client).toBe(true);
  });

  it("supplies a generic wrong-owner message when the model left one blank", () => {
    const out = parseClassification({
      ...base,
      belongs_to_client: false,
      belongs_confidence: 0.9,
      issue_summary_en: "",
      issue_summary_fr: "",
    });
    expect(out?.usability.issue_summary_en).not.toBe("");
    expect(out?.usability.issue_summary_fr).not.toBe("");
  });

  it("lets obscured key-values take precedence over the wrong-owner message", () => {
    const out = parseClassification({
      ...base,
      key_values_obscured: true,
      belongs_to_client: false,
      belongs_confidence: 0.9,
    });
    expect(out?.usability.usable).toBe(false);
    expect(out?.usability.primary_issue).toBe("key_fields_obscured");
  });
});
