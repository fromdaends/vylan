// The plain-language, client-facing reason a single portal file needs fixing,
// in BOTH languages so the portal can follow its language toggle. PURE +
// side-effect free so it is the one source of truth for the rule and can be
// unit-tested directly; loadPortalContext just attaches whatever this returns
// to each PortalFile.
//
// The rule (founder's spec: the client portal must never show internal / AI
// jargon, only plain language):
//   * Only a file that was actually sent back (review_status 'rejected') gets a
//     reason. Approved / in-review files return null (no reason line).
//   * The AI's bilingual client summary wins: issue_summary_fr / issue_summary_en
//     are written FOR the client, so they follow the language toggle exactly.
//   * Otherwise fall back to the accountant's typed rejection_reason. That column
//     is a single language, so it is mirrored into both fr and en (better to show
//     the same words in both than to show nothing).
//   * A rejected file with neither a usable AI summary nor a typed reason returns
//     null. The file still reads "needs a fix" via its status pill, just with no
//     extra sentence (never a blank or broken line).
//
// Client-safe by construction: both sources are plain language. This helper
// never surfaces a document-type code, a confidence score, or the word
// "flagged".

export type FileReason = { fr: string; en: string };

// Only the two fields this rule reads, so callers and tests don't have to build
// a whole UsabilityVerdict. A real UsabilityVerdict is structurally assignable.
type UsabilitySummary = {
  issue_summary_fr?: string | null;
  issue_summary_en?: string | null;
};

export function resolveFileReason(
  reviewStatus: "pending" | "approved" | "rejected",
  usability: UsabilitySummary | null | undefined,
  rejectionReason: string | null | undefined,
): FileReason | null {
  if (reviewStatus !== "rejected") return null;
  const fr = usability?.issue_summary_fr?.trim();
  const en = usability?.issue_summary_en?.trim();
  if (fr || en) return { fr: fr || en || "", en: en || fr || "" };
  const typed = rejectionReason?.trim();
  if (typed) return { fr: typed, en: typed };
  return null;
}
