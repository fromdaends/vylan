// Shared types + constants for the AI usability assessment.
//
// Phases 2 (classifier) writes the verdict, Phase 3 (router) acts on
// it, Phase 5 (UI) shows it. Putting the shapes here keeps them in one
// place so a future enum tweak doesn't need to touch four files.

export const USABILITY_ISSUES = [
  "text_unreadable",
  "key_fields_obscured",
  "partial_capture",
  "glare_or_shadow",
  "wrong_document_type",
  "corrupt_or_blank",
  "wrong_orientation",
  "password_protected",
  "missing_pages",
  "screenshot_of_screen",
  "other",
] as const;

export type UsabilityIssue = (typeof USABILITY_ISSUES)[number];

export function isUsabilityIssue(v: unknown): v is UsabilityIssue {
  return (
    typeof v === "string" &&
    (USABILITY_ISSUES as readonly string[]).includes(v)
  );
}

// Confidence below this means the AI was hesitant — surface as a soft
// warning in Phase 5, but never auto-reject. Tunable in one place.
export const USABILITY_CONFIDENCE_THRESHOLD = 0.8;

export type UsabilityVerdict = {
  usable: boolean;
  confidence: number;
  primary_issue: UsabilityIssue | null;
  all_issues: UsabilityIssue[];
  // Short client-facing reason, AI-written. Used verbatim in the
  // retry email/SMS in Phase 4, so the prompt asks for friendly,
  // specific wording (not "blurry image").
  issue_summary_fr: string;
  issue_summary_en: string;
};

// Fail-safe default: when the model returns malformed output, we'd
// rather treat the upload as usable than auto-reject a clean file.
// Phase 5 can show a "couldn't assess" badge based on the zero
// confidence.
export const USABLE_BY_DEFAULT: UsabilityVerdict = {
  usable: true,
  confidence: 0,
  primary_issue: null,
  all_issues: [],
  issue_summary_fr: "",
  issue_summary_en: "",
};

// Single source of truth for "should we actually act on this verdict?"
// Phase 3 routes on this. Below the threshold = informational only.
//
// The wrong-OWNER hard reject lives in classify.ts (withWrongRecipient), driven
// by the model's holistic belongs_to_client judgment — NOT a blunt name-token
// match — so a business / spouse / dependant the model reasoned through is never
// bounced. It produces a usable=false verdict, so it flows through this same
// shouldActOnUsability gate and the existing router like any other reject.
export function shouldActOnUsability(v: UsabilityVerdict): boolean {
  return v.usable === false && v.confidence >= USABILITY_CONFIDENCE_THRESHOLD;
}
