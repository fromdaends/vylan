// One-glance AI verdict for a scanned file on the engagement checklist.
//
// The checklist used to stack two heavy panels per file — a usability badge
// ("is this readable / was it auto-rejected?") and a type badge ("is this the
// right slip?"). That's the right depth for the Preview page, but on the
// checklist it's noise. This collapses every signal into a SINGLE headline so
// the row reads at a glance; the full read still lives in Preview.
//
// Pure + framework-free so the priority logic is unit-tested directly. The
// component feeds in already-computed booleans (usability from the verdict,
// typeConcern from matchDocument) and maps the result to copy + colour.

export type AiHeadlineTone = "good" | "warn" | "bad" | "neutral";

export type AiHeadlineKind =
  | "looks_right" // usable + right type, confident
  | "low_confidence" // usable + right type, but the model wasn't sure
  | "wrong_type" // usable but the wrong slip (or unidentifiable)
  | "auto_rejected" // unusable, system already messaged the client
  | "escalated" // unusable + repeat strikes — needs human eyes
  | "flagged" // unusable but no auto-action — glance at it
  | "analyzing" // read still in flight
  | "not_analyzed" // read never ran (quota off / stale)
  | "code_read"; // read in code (text-layer PDF / Excel / CSV) — no AI needed

export type AiHeadline = { kind: AiHeadlineKind; tone: AiHeadlineTone };

// ---------------------------------------------------------------------------
// deriveFileAi: turn one uploaded file + its checklist context into the verdict
// view the engagement row renders (status chip + whole-row tone). Pure so it's
// unit-tested directly; the component layers i18n + colour on top. Mirrors the
// gating the old FileAiSummary did, minus the framework.
// ---------------------------------------------------------------------------

import { matchDocument } from "@/lib/ai/matching";
import { isCodeReadFields } from "@/lib/ai/code-read";
import type { DocType } from "@/lib/db/templates";

// 15 min: past this an un-run analysis is treated as "never ran", not in-flight.
const ANALYSIS_FRESH_MS = 15 * 60 * 1000;

export type FileAiInput = {
  ai_classification: string | null;
  ai_confidence: number | null;
  ai_usability:
    | { usable?: boolean; issue_summary_fr?: string; issue_summary_en?: string }
    | null;
  ai_rejected: boolean;
  ai_extracted_fields: Record<string, unknown> | null;
  review_status: "pending" | "approved" | "rejected";
  uploaded_at: string;
};

export type FileAiView = {
  /** false → render no AI chrome (accountant already decided, read never ran). */
  show: boolean;
  headline: AiHeadline;
  analyzed: boolean;
  confidence: number;
  /** Headline "is this the right + usable document" score (0-1) — what the row
   *  shows prominently. Falls back to the type confidence for files analysed
   *  before the model returned an overall score. */
  overallConfidence: number;
  detected: string;
  year: number | null;
  issuer: string | null;
  party: string | null;
  isUnknown: boolean;
  isUsabilityProblem: boolean;
  /** First type/year/identity mismatch, for the inline detail. */
  mismatch: { kind: string; expected: string; actual: string } | null;
  modelConcern: string | null;
  summaryFr: string;
  summaryEn: string;
};

export function deriveFileAi(
  file: FileAiInput,
  ctx: {
    expectedDocType: DocType;
    expectedYear: number | null;
    clientName: string | null;
    /** Strike counter on the item — drives the "escalated" headline. */
    rejectionCount: number;
  },
  nowMs: number,
): FileAiView {
  const analyzed =
    file.ai_classification != null && file.ai_confidence != null;

  // The code-readable fast path read this file's contents directly (text-layer
  // PDF / Excel / CSV) — no vision model ran, so ai_classification is null but
  // the read IS done. Surface an honest neutral "readable" state instead of the
  // "analyzing" spinner / "not analyzed" the null classification would otherwise
  // trigger. Only affects code-read files; the AI path is untouched.
  const codeRead = isCodeReadFields(file.ai_extracted_fields);

  // Accountant already ruled on a file the read never finished → stay silent.
  // (Applies to code-read files too: once approved/rejected, their neutral chip
  // drops away like any decided file's AI chrome.)
  const supersededUnanalyzed =
    !analyzed &&
    (file.review_status === "approved" || file.review_status === "rejected");

  const fields = (file.ai_extracted_fields ?? {}) as {
    extracted_year?: unknown;
    looks_correct?: unknown;
    issue_if_any?: unknown;
    issuer_name?: unknown;
    party_name?: unknown;
    fields_confidence?: unknown;
    belongs_to_client?: unknown;
    belongs_confidence?: unknown;
    overall_confidence?: unknown;
  };
  const detected = file.ai_classification ?? "";
  const conf = file.ai_confidence ?? 0;
  const isUnknown = detected === "unknown";
  const year =
    typeof fields.extracted_year === "number" ? fields.extracted_year : null;
  const issuer = typeof fields.issuer_name === "string" ? fields.issuer_name : null;
  const party = typeof fields.party_name === "string" ? fields.party_name : null;
  // The field-extraction confidence the matcher gates its year + identity checks
  // on (it stays quiet below 0.5). This MUST be the REAL value the AI wrote:
  // feeding it 0 silenced those checks here, which is exactly why the checklist
  // read green "looks right" while the Preview — which passes the real value via
  // mismatchesRequest — flagged the SAME file. Pass it through so the checklist
  // badge and the Preview can never disagree.
  const fieldsConf =
    typeof fields.fields_confidence === "number" ? fields.fields_confidence : 0;
  const belongsToClient =
    typeof fields.belongs_to_client === "boolean"
      ? fields.belongs_to_client
      : null;
  const belongsConf =
    typeof fields.belongs_confidence === "number"
      ? fields.belongs_confidence
      : 0;
  // The headline "is this the right + usable document" score the row shows. Falls
  // back to the type-classification confidence for files analysed before the
  // model started returning an overall score.
  const overallConfidence =
    typeof fields.overall_confidence === "number"
      ? fields.overall_confidence
      : conf;

  const flags = analyzed
    ? matchDocument({
        expectedDocType: ctx.expectedDocType,
        expectedYear: ctx.expectedYear,
        clientName: ctx.clientName,
        classification: {
          document_type: detected as DocType | "unknown",
          confidence: conf,
          extracted_year: year,
          party_name: party,
          fields_confidence: fieldsConf,
          belongs_to_client: belongsToClient,
          belongs_confidence: belongsConf,
        },
      })
    : [];
  const modelConcern =
    fields.looks_correct === false && typeof fields.issue_if_any === "string"
      ? fields.issue_if_any
      : null;
  const typeConcern = isUnknown || flags.length > 0 || modelConcern !== null;

  const stale =
    !analyzed &&
    nowMs - new Date(file.uploaded_at).getTime() > ANALYSIS_FRESH_MS;

  const usable = file.ai_usability ? (file.ai_usability.usable ?? null) : null;

  const headline = pickAiHeadline({
    analyzed,
    stale,
    usable,
    aiRejected: file.ai_rejected,
    rejectionCount: ctx.rejectionCount,
    typeConcern,
    lowConfidence: conf < 0.5,
    codeRead,
  });

  const isUsabilityProblem =
    headline.kind === "auto_rejected" ||
    headline.kind === "escalated" ||
    headline.kind === "flagged";

  // Prefer the identity (wrong-person) flag for the one-line row reason when it's
  // present — a name mismatch is the single most important thing for the
  // accountant to see — then fall back to the first flag (type / year). The
  // Preview still lists every flag in full.
  const firstFlag =
    flags.find((f) => f.kind === "identity_mismatch") ?? flags[0] ?? null;

  return {
    show: !supersededUnanalyzed,
    headline,
    analyzed,
    confidence: conf,
    overallConfidence,
    detected,
    year,
    issuer,
    party,
    isUnknown,
    isUsabilityProblem,
    mismatch: firstFlag
      ? { kind: firstFlag.kind, expected: firstFlag.expected, actual: firstFlag.actual }
      : null,
    modelConcern,
    summaryFr: file.ai_usability?.issue_summary_fr ?? "",
    summaryEn: file.ai_usability?.issue_summary_en ?? "",
  };
}

export function pickAiHeadline(p: {
  /** ai_classification AND ai_confidence are both present. */
  analyzed: boolean;
  /** Not analyzed and old enough that it's not "in flight" anymore. */
  stale: boolean;
  /** ai_usability.usable — null when there's no usability verdict at all. */
  usable: boolean | null;
  /** The system actually auto-rejected this upload. */
  aiRejected: boolean;
  /** How many times this checklist item has been rejected (strike counter). */
  rejectionCount: number;
  /** matchDocument found a type/year/identity problem, or the type is unknown. */
  typeConcern: boolean;
  /** ai_confidence < 0.5 — a hedge worth surfacing even with no hard concern. */
  lowConfidence: boolean;
  /** File was read in code (text-layer PDF / Excel / CSV) — no AI ran. */
  codeRead?: boolean;
}): AiHeadline {
  // A code-read file is a terminal, honest state of its own — never "analyzing"
  // or "not analyzed" (the read IS done, just not by the model) and never a
  // type/usability verdict (code didn't judge the document). Short-circuit first.
  if (p.codeRead) return { kind: "code_read", tone: "neutral" };

  if (!p.analyzed) {
    return p.stale
      ? { kind: "not_analyzed", tone: "neutral" }
      : { kind: "analyzing", tone: "neutral" };
  }

  // A readability/usability problem outranks the type read — a file the client
  // needs to re-send shouldn't also wear a "looks like a T4" verdict.
  if (p.usable === false) {
    if (p.rejectionCount >= 2 && p.aiRejected) {
      return { kind: "escalated", tone: "bad" };
    }
    if (p.aiRejected) return { kind: "auto_rejected", tone: "warn" };
    return { kind: "flagged", tone: "warn" };
  }

  // Usable (or no usability verdict) → judge whether it's the right document.
  if (p.typeConcern) return { kind: "wrong_type", tone: "bad" };
  if (p.lowConfidence) return { kind: "low_confidence", tone: "warn" };
  return { kind: "looks_right", tone: "good" };
}
