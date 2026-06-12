// Expected-vs-actual matching for AI document analysis (Phase 4).
//
// A PURE, side-effect-free comparator. It takes what the accountant EXPECTED
// for a checklist item (the requested doc type, the tax year, the client's
// name) and what the AI READ off the uploaded file (the Phase 2/3 output), and
// returns mismatch FLAGS — never decisions. Every flag is a confidence-scored
// SUGGESTION the accountant approves or dismisses; nothing here auto-rejects.
//
// Deliberately conservative — a false flag erodes trust faster than a miss:
//   * a mismatch only surfaces when the AI was reasonably sure (>= 0.5);
//   * identity prefers the model's holistic belongs_to_client judgment (it
//     weighs business names, spouses, dependants — not just the name), and
//     falls back to a name-token heuristic only for older data without it.

import type { DocType } from "@/lib/db/templates";

export type MatchFlagKind =
  | "type_mismatch"
  | "year_mismatch"
  | "identity_mismatch";

export type MatchFlag = {
  kind: MatchFlagKind;
  confidence: number;
  expected: string;
  actual: string;
};

// The subset of the AI classification the matcher needs (Phase 2/3 output).
export type MatchClassification = {
  document_type: DocType | "unknown";
  confidence: number;
  extracted_year: number | null;
  party_name: string | null;
  fields_confidence: number;
  // The model's HOLISTIC "does this document belong to the client?" judgment —
  // it weighs business names, spouses, dependants, and context, not just the
  // name. null on older classifications that predate it (then the matcher falls
  // back to the name-token heuristic); when present it OVERRIDES that heuristic.
  belongs_to_client?: boolean | null;
  belongs_confidence?: number;
};

export type MatchInput = {
  expectedDocType: DocType;
  expectedYear: number | null;
  clientName: string | null;
  classification: MatchClassification;
};

// Below this we treat the AI as "unsure" and stay quiet rather than raise a
// confident-looking mismatch the accountant would have to second-guess.
export const MIN_FLAG_CONFIDENCE = 0.5;

export function matchDocument(input: MatchInput): MatchFlag[] {
  const flags: MatchFlag[] = [];
  const c = input.classification;

  // TYPE — detected type differs from the requested one. Two non-mismatches:
  //   * "unknown" is a "couldn't tell", not a mismatch (surfaced separately);
  //   * an expected type of "other" means the checklist item didn't ask for a
  //     specific document — it's the default for freeform/custom items — so any
  //     recognised type is acceptable and must never raise a type mismatch.
  if (
    c.document_type !== "unknown" &&
    input.expectedDocType !== "other" &&
    c.document_type !== input.expectedDocType &&
    c.confidence >= MIN_FLAG_CONFIDENCE
  ) {
    flags.push({
      kind: "type_mismatch",
      confidence: c.confidence,
      expected: input.expectedDocType,
      actual: c.document_type,
    });
  }

  // YEAR — only when we know the expected year AND read one off the file.
  if (
    input.expectedYear != null &&
    c.extracted_year != null &&
    c.extracted_year !== input.expectedYear &&
    c.fields_confidence >= MIN_FLAG_CONFIDENCE
  ) {
    flags.push({
      kind: "year_mismatch",
      confidence: c.fields_confidence,
      expected: String(input.expectedYear),
      actual: String(c.extracted_year),
    });
  }

  // IDENTITY — does the document belong to the client? PREFER the model's
  // holistic belongs_to_client judgment (it weighs business names, spouses,
  // dependants, and context — not just the name). Fall back to the name-token
  // heuristic ONLY for older classifications that predate that signal
  // (belongs_to_client == null), so historical files still surface a mismatch.
  // Soft flag only here — the CONFIDENT wrong-owner hard reject lives in
  // classify.ts (withWrongRecipient), off the same belongs_to_client judgment.
  if (
    c.belongs_to_client === false &&
    (c.belongs_confidence ?? 0) >= MIN_FLAG_CONFIDENCE
  ) {
    flags.push({
      kind: "identity_mismatch",
      confidence: c.belongs_confidence ?? MIN_FLAG_CONFIDENCE,
      expected: input.clientName ?? "",
      actual: c.party_name ?? "",
    });
  } else if (
    c.belongs_to_client == null &&
    input.clientName &&
    c.party_name &&
    c.fields_confidence >= MIN_FLAG_CONFIDENCE &&
    !namesOverlap(input.clientName, c.party_name)
  ) {
    flags.push({
      kind: "identity_mismatch",
      confidence: c.fields_confidence,
      expected: input.clientName,
      actual: c.party_name,
    });
  }

  return flags;
}

// A single 20xx year in the engagement title is taken as the expected tax year
// (e.g. "Smith — T1 2024"). Zero or several → null; we never guess a year. A
// structured expected-tax-year field would make this universal (a noted
// follow-up), but the title covers the common case with no schema change.
export function expectedYearFromTitle(title: string): number | null {
  const found = title.match(/\b20\d{2}\b/g);
  if (!found || found.length !== 1) return null;
  const y = Number(found[0]);
  return y >= 2000 && y <= 2099 ? y : null;
}

// Normalize a name to comparable tokens: lowercase, strip accents + punctuation,
// drop 1-char noise (initials).
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

// Do the two names share ANY meaningful token? Used to SUPPRESS the identity
// flag — we only surface a complete stranger. Unreadable names (no tokens)
// never flag.
function namesOverlap(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return true;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}
