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
export function shouldActOnUsability(v: UsabilityVerdict): boolean {
  return v.usable === false && v.confidence >= USABILITY_CONFIDENCE_THRESHOLD;
}

// Founder rule: a clean scan of the WRONG person's document is still the wrong
// document, and must NEVER be silently accepted. When the deterministic matcher
// finds the named owner is a stranger to the client (no shared name token, AI
// reasonably sure), we fold that into a usable=false verdict so the EXISTING
// reject/notify router handles it exactly like any other unusable upload — and
// every status surface (checklist badge, Preview, client portal) stays
// consistent, instead of one view flagging while another reads "looks right".
//
// primary_issue reuses "wrong_document_type" — the closest "this is not the
// requested document" bucket already wired through the UI — and the
// human-readable summary carries the real explanation (the wrong name). The
// confidence is floored at the act threshold so the router always acts on it,
// honouring the "never accepted under any conditions" rule regardless of how
// the AI scored mere legibility.
export function wrongRecipientVerdict(
  base: UsabilityVerdict,
  clientName: string,
  detectedName: string,
  matchConfidence: number,
): UsabilityVerdict {
  return {
    usable: false,
    confidence: Math.max(
      base.confidence,
      matchConfidence,
      USABILITY_CONFIDENCE_THRESHOLD,
    ),
    primary_issue: "wrong_document_type",
    all_issues: Array.from(
      new Set<UsabilityIssue>([...base.all_issues, "wrong_document_type"]),
    ),
    issue_summary_fr: `Ce document semble appartenir à une autre personne (nous avons lu « ${detectedName} »). Merci de téléverser le document de ${clientName}.`,
    issue_summary_en: `This document appears to belong to someone else (we read "${detectedName}"). Please upload ${clientName}'s document.`,
  };
}
