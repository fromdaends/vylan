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
  | "not_analyzed"; // read never ran (quota off / stale)

export type AiHeadline = { kind: AiHeadlineKind; tone: AiHeadlineTone };

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
}): AiHeadline {
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
