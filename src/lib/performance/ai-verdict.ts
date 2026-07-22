// The bridge between the AI's checklist verdict and the four-case agreement
// matrix. It reuses deriveFileAi — the EXACT function the engagement checklist
// renders — so the Performance number always matches what the accountant saw.
// Nothing here re-implements the verdict; it only replays and classifies it.

import {
  deriveFileAi,
  type FileAiInput,
} from "@/lib/engagements/file-ai-headline";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import type { DocType } from "@/lib/db/templates";
import type { FourCase } from "./types";

export type AiBinary = "pass" | "flag";

// Collapse the derived checklist headline into the two buckets the agreement
// matrix uses. Only ANALYZED files reach here, so 'analyzing'/'not_analyzed'
// never occur. We treat ONLY the clean-green 'looks_right' as the AI passing the
// document; every other analyzed verdict (low_confidence, wrong_type, flagged,
// auto_rejected, escalated) is the AI raising a concern.
export function aiBinaryFromKind(kind: string): AiBinary {
  return kind === "looks_right" ? "pass" : "flag";
}

// The four-case classification: the AI's call crossed with the accountant's.
export function classifyFourCase(
  ai: AiBinary,
  decision: "approved" | "rejected",
): FourCase {
  if (ai === "pass") {
    return decision === "approved" ? "true_pass" : "false_pass";
  }
  return decision === "rejected" ? "true_catch" : "false_alarm";
}

// One document's inputs for the historical verdict replay. Mirrors exactly what
// the engagement checklist feeds deriveFileAi, sourced from stored columns:
// the file's own AI fields, the requested doc type + strike count from its
// checklist item, and the engagement title (for the expected tax year) + client
// name for the identity check.
export type AiScorableFile = {
  file: FileAiInput;
  expectedDocType: DocType;
  engagementTitle: string;
  clientName: string | null;
  rejectionCount: number;
  decision: "approved" | "rejected";
};

// Replay the checklist verdict for one document and classify it. nowMs feeds
// deriveFileAi's staleness check, which only matters for un-analyzed files;
// scorable files are analyzed by definition, so the result is deterministic.
export function scoreFile(input: AiScorableFile, nowMs: number): FourCase {
  const view = deriveFileAi(
    input.file,
    {
      expectedDocType: input.expectedDocType,
      expectedYear: expectedYearFromTitle(input.engagementTitle),
      clientName: input.clientName,
      rejectionCount: input.rejectionCount,
    },
    nowMs,
  );
  return classifyFourCase(aiBinaryFromKind(view.headline.kind), input.decision);
}
