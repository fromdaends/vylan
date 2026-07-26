// Set-level (item-scoped) document assessment — Phase 1 plumbing.
//
// Today every uploaded file is classified ALONE, so a 4-page statement
// photographed page-by-page becomes four blind verdicts ("only page 1 of 4 was
// uploaded" × 4). This worker gathers ALL of an item's non-duplicate files into
// ONE multi-image model call and stores the set-level verdict on
// request_items.ai_set_assessment (migration 0320): a one-sentence conclusion
// (EN + FR), a confidence, a per-file page map, and flags.
//
// Trigger: scheduleSetAssessment() is called on every portal upload. It keeps a
// SINGLE pending assess_item_set job per item (unique partial index, 0320) and
// pushes its run_after ~2 minutes out each time — so a burst of uploads settles
// into ONE assessment, run by the every-2-minutes jobs cron. One run bills ONE
// unit against the firm's monthly AI cap, same guards as classify.

import Anthropic from "@anthropic-ai/sdk";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  checkRateLimit,
  AI_CLASSIFY_PER_FIRM_DAILY,
} from "@/lib/rate-limit";
import {
  isAiConfigured,
  getProvider,
  getOpenAiModel,
  normalizeImageForAi,
  downloadStorageObject,
  normalizeMimeType,
  isSupportedAiMime,
} from "./classify";
import { assessSetWithOpenAI } from "./openai-classify";
import { getFirmAiUsage, incrementFirmAiUsage } from "./usage";
import { isEngagementAiEnabled } from "./engagement-ai";
import { expectedYearFromTitle } from "./matching";
import { enqueueJob } from "@/lib/db/jobs";
import { recomputeItemStatus } from "@/lib/db/file-review";
import {
  applyDuplicateDecision,
  type DuplicateDecision,
} from "@/lib/duplicates";

// Keep in sync with MODEL in classify.ts — the set assessment rides the same
// provider + model choices as the per-file classifier.
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Stored shape (request_items.ai_set_assessment)
// ---------------------------------------------------------------------------

export type SetAssessmentPlacement = "printed" | "inferred" | "unconfirmed";

// The routing-relevant conclusion about the whole set:
//   complete     — every page is present (a whole multi-page doc, or a complete
//                  single document); no action needed.
//   incomplete   — a specific page is CONFIDENTLY missing (e.g. page 3 of 4).
//   unplaceable  — at least one file could not be confidently placed; the chain
//                  did not lock, so it routes to the accountant, never a guess.
//   not_a_set    — the files are separate documents (e.g. a pile of receipts),
//                  no page sequence to complete; treated like complete for
//                  routing (no missing-page action).
export type SetOutcome = "complete" | "incomplete" | "unplaceable" | "not_a_set";

const SET_OUTCOMES: readonly SetOutcome[] = [
  "complete",
  "incomplete",
  "unplaceable",
  "not_a_set",
];

export type SetAssessmentPage = {
  file_id: string;
  /** Page number within the assembled document; null when not applicable. */
  position: number | null;
  /** Total pages of the document this file belongs to; null when unknown. */
  of_total: number | null;
  /** How the position was established. "unconfirmed" = could not be placed. */
  placement: SetAssessmentPlacement;
  /** Short per-file remark ("" when none). */
  note: string;
  /**
   * Content-aware duplicate (Phase 4): the id of an EARLIER file in the set this
   * file is the SAME actual document/page as (identical specific content, not
   * just the same kind of document). Null when this file is unique. A different
   * page of the same document is NEVER a duplicate.
   */
  duplicate_of_file_id: string | null;
  /**
   * How certain (0-1) the file is that very same document, when it IS a
   * duplicate. Gates the Phase 5 auto-reject (vs flag). 0 when not a duplicate.
   */
  duplicate_confidence: number;
};

export type SetAssessment = {
  conclusion_en: string;
  conclusion_fr: string;
  confidence: number;
  /** Routing-relevant verdict about the whole set. */
  outcome: SetOutcome;
  /** Plain client-facing ask for the missing page(s); only set when incomplete. */
  client_request_fr: string;
  client_request_en: string;
  /**
   * Routing-derived: the client is being asked to send a missing page, so the
   * item-status roll-up keeps the item "waiting on the client" until a newer
   * upload answers it. True only on a confident, opted-in incomplete set.
   * Optional so assessments written before this field read as false.
   */
  needs_client?: boolean;
  pages: SetAssessmentPage[];
  flags: string[];
  assessed_at: string;
  /** Sorted "<file_id>:<content_hash>" of the files this run actually covered —
   *  lets readers detect a stale assessment after later uploads/deletes. */
  files_signature: string[];
};

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

// Debounce window: a new upload pushes the item's single pending job this far
// out, so the assessment runs once the burst has settled. ~2 minutes balances
// "client is still photographing pages" against "accountant wants the verdict
// soon"; with the */2 cron the verdict lands ~2-4 min after the LAST upload.
export const SET_ASSESSMENT_DEBOUNCE_MS = 2 * 60 * 1000;

// Payload bounds for ONE call. 10 files at the 2048px/JPEG-q90 prep is far
// under provider request limits while covering any realistic page set; the
// byte budget guards the PDF case (uploads can be 25 MB each). When an item
// holds more, the first files (upload order) are assessed and a flag says so.
export const MAX_SET_FILES = 10;
export const MAX_SET_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Scheduling (debounced, one pending job per item)
// ---------------------------------------------------------------------------

// Best-effort by design: scheduling must never fail an upload. Push back the
// item's single pending job if there is one; otherwise insert it. The unique
// partial index (0320) makes a concurrent double-insert lose cleanly — the
// loser falls back to pushing the winner's job.
export async function scheduleSetAssessment(
  requestItemId: string,
): Promise<void> {
  try {
    const sb = getServiceRoleSupabase();
    const due = new Date(
      Date.now() + SET_ASSESSMENT_DEBOUNCE_MS,
    ).toISOString();
    const { data: pushed, error: pushErr } = await sb
      .from("jobs")
      .update({ run_after: due })
      .eq("kind", "assess_item_set")
      .eq("status", "pending")
      .eq("payload->>request_item_id", requestItemId)
      .select("id");
    if (pushErr) throw pushErr;
    if (pushed && pushed.length > 0) return;
    const { error: insErr } = await sb.from("jobs").insert({
      kind: "assess_item_set",
      payload: { request_item_id: requestItemId },
      run_after: due,
      status: "pending",
    });
    if (!insErr) return;
    // Unique-index race: another upload inserted first — push that job back.
    const { error: retryErr } = await sb
      .from("jobs")
      .update({ run_after: due })
      .eq("kind", "assess_item_set")
      .eq("status", "pending")
      .eq("payload->>request_item_id", requestItemId);
    if (retryErr) throw retryErr;
  } catch (e) {
    console.error("[ai/assess-set] scheduling failed (assessment skipped):", e);
  }
}

// ---------------------------------------------------------------------------
// Model contract
// ---------------------------------------------------------------------------

// Shared between providers: Anthropic uses it as a tool schema, OpenAI as a
// strict Structured Outputs schema (via toStrictSchema, which strips the
// numeric bounds — parseSetAssessment clamps anyway).
export const SET_ASSESSMENT_TOOL = {
  name: "assess_item_set",
  description:
    "Return a structured assessment of ALL files uploaded to one checklist item, judged together as a set.",
  input_schema: {
    type: "object",
    properties: {
      conclusion_en: {
        type: "string",
        description:
          "ONE short plain-English sentence for the accountant: what the set is and whether it is complete. Name missing pages specifically.",
      },
      conclusion_fr: {
        type: "string",
        description:
          "The same conclusion in plain Quebec French. No jargon, no codes, no percentages, never mention AI.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Honest confidence in the conclusion, 0 to 1. Use below 0.80 whenever unsure.",
      },
      outcome: {
        type: "string",
        enum: ["complete", "incomplete", "unplaceable", "not_a_set"],
        description:
          "The routing verdict about the whole set: 'complete' = every page is present (a whole multi-page document, or a complete single document); 'incomplete' = a specific page is CONFIDENTLY missing; 'unplaceable' = at least one file could not be confidently placed (the chain did not lock — do NOT guess, route to the accountant); 'not_a_set' = the files are separate documents with no page sequence (e.g. a pile of receipts).",
      },
      pages: {
        type: "array",
        description:
          "One entry per file, mapping it into the set. Files that are separate documents get position/of_total null.",
        items: {
          type: "object",
          properties: {
            image_index: {
              type: "integer",
              description:
                "1-based position of the file as presented (File 1 = first uploaded).",
            },
            position: {
              type: ["integer", "null"],
              description:
                "Page number within the assembled document, when applicable.",
            },
            of_total: {
              type: ["integer", "null"],
              description:
                "Total pages of the document this file belongs to, when known.",
            },
            placement: {
              type: "string",
              enum: ["printed", "inferred", "unconfirmed"],
              description:
                "printed = page number readable on the page; inferred = locked by content continuity (say which evidence in note); unconfirmed = cannot be placed — never guess.",
            },
            note: {
              type: "string",
              description:
                "Short remark about this file when useful (e.g. 'page-number footer cut off, placed by the running balance'). Empty string when none.",
            },
            duplicate_of_image_index: {
              type: ["integer", "null"],
              description:
                "If this file is the SAME actual document or page as an EARLIER file in this set (identical specific content — not just the same kind of document), the 1-based image_index of that earlier file. Null otherwise. A different page of the same document is NOT a duplicate.",
            },
            duplicate_confidence: {
              type: ["number", "null"],
              description:
                "When duplicate_of_image_index is set, how certain (0-1) you are that the two files are the VERY SAME document. Reserve values at or above 0.9 for cases you are nearly certain about. Null when this file is not a duplicate.",
            },
          },
          required: [
            "image_index",
            "position",
            "of_total",
            "placement",
            "note",
            "duplicate_of_image_index",
            "duplicate_confidence",
          ],
        },
      },
      flags: {
        type: "array",
        items: { type: "string" },
        description:
          "Short, specific accountant-facing warnings ONLY when something needs attention (missing page, unreadable file, unrelated file). Empty when all is well.",
      },
      client_request_fr: {
        type: "string",
        description:
          "ONLY when outcome is 'incomplete': ONE short, friendly, plain Quebec French sentence asking the CLIENT to send the specific missing page(s), e.g. 'Il manque la page 3 sur 4 de votre relevé bancaire. Pourriez-vous l'ajouter?'. No jargon, no codes, no percentages, never mention AI. Empty string for any other outcome.",
      },
      client_request_en: {
        type: "string",
        description:
          "The English equivalent of client_request_fr, written for the client. Empty string when outcome is not 'incomplete'.",
      },
    },
    required: [
      "conclusion_en",
      "conclusion_fr",
      "confidence",
      "outcome",
      "pages",
      "flags",
      "client_request_fr",
      "client_request_en",
    ],
  },
} as const;

type SetRequestContext = {
  requestLabel: string | null;
  requestLabelFr: string | null;
  clientName: string | null;
  expectedYear: number | null;
  // Optional per-item note the accountant typed to steer the AI (migration
  // 0390). Blank/null leaves the prompt unchanged from before.
  aiInstructions: string | null;
};

export function buildSetSystemPrompt(
  ctx: SetRequestContext,
  fileCount: number,
): string {
  const label = ctx.requestLabel?.trim() || "(no label)";
  const labelFr = ctx.requestLabelFr?.trim() || "(no French label)";
  const clientName = ctx.clientName?.trim() || "(unknown)";
  const year = ctx.expectedYear != null ? String(ctx.expectedYear) : "(unknown)";
  // Optional accountant guidance for this item. Advisory only — it informs the
  // judgment but never overrides the grounded-in-the-files rules below.
  const note = ctx.aiInstructions?.trim();
  const noteLine = note
    ? `\n- Accountant's note for this item (guidance, not an override): "${note}"`
    : "";
  return `You are a meticulous assistant to a Quebec accountant. A client uploaded ${fileCount} file(s) into ONE checklist item of a document request. Each file has already been examined alone; YOUR job is to judge them TOGETHER as a set.

Request context:
- Requested item: "${label}" (French label: "${labelFr}")
- Client: ${clientName}
- Expected tax year: ${year}${noteLine}

First decide what the files form together:
- ONE multi-page document split across several files (e.g. a 4-page bank statement photographed page by page),
- SEVERAL separate documents (e.g. many different receipts — normal for a receipts item; do NOT invent a page order between unrelated documents),
- or a mix.

GROUND EVERYTHING IN THE ${fileCount} FILE(S) YOU WERE ACTUALLY GIVEN. Never claim a page is "present" unless one of these files IS that page, and never invent or count pages you were not shown. If the files are pages of DIFFERENT documents — for example two different monthly statements, two different statement periods, or otherwise unrelated documents — they do NOT form one set: say so plainly in the conclusion (e.g. "these are page 1 of two different monthly statements"), set outcome to "not_a_set", and do NOT merge them into a single page inventory or call any page "missing". "Missing page" only makes sense WITHIN one and the same document.

For every file, add one pages[] entry:
- image_index: the 1-based "File N" position as presented (File 1 was uploaded first).
- position / of_total: page number and total when they apply; null when they do not (e.g. separate receipts).
- placement:
  * "printed" — a page indicator is printed and readable on the page itself (e.g. "page 2 de 4", "2/4").
  * "inferred" — no readable printed number, but the content locks the position: a running balance chaining from the previous page's closing balance, transactions/dates that continue across pages, a "continued"/"suite" marker, an opening- or closing-balance line. State WHICH evidence in note.
  * "unconfirmed" — you cannot confirm where the file belongs. NEVER silently guess a position.
- note: one short remark when useful (e.g. "page-number footer cut off; placed by the running balance"); empty string otherwise.

Duplicates within the set (content-aware — judge the actual document, not its bytes):
- If a file is the SAME actual document or the SAME page as an EARLIER file already in this set — identical SPECIFIC content (same date, same amounts, same transactions, same account, the very same page photographed again) — set its duplicate_of_image_index to that earlier file's image_index. The earliest copy is the keeper; only the later copy is the duplicate.
- A DIFFERENT page of the same document is NEVER a duplicate — it completes the set.
- Two documents that merely share a merchant, a layout, or a format are NOT duplicates: a dozen receipts from the same pharmacy, or a recurring monthly bill, are DIFFERENT documents (different dates, amounts, transactions). Leave duplicate_of_image_index null for all of them.
- When you DO mark a duplicate, also set duplicate_confidence (0 to 1) to how certain you are the two are the very same document. Reserve 0.9 and above for cases you are nearly certain about — that high band is what may be auto-rejected; anything lower is sent to the accountant.
- When you are not certain two files are the very same document, leave duplicate_of_image_index null. Never over-flag a duplicate.

Cropping has two very different severities — keep them apart:
- If only a blank margin or the page-number FOOTER is cropped but ALL of the page's actual content is visible, the page is fine: place it by content continuity and note "page number not visible". Do NOT treat it as missing or unreadable.
- If real CONTENT is sliced off (a column, a row, an amount cut out of frame so it cannot be read), that page needs to be retaken. Flag it, and do not let it count as a confidently placed page.

Then conclude:
- conclusion_en and conclusion_fr: ONE short sentence each, plain words, written for the accountant. Say what the set is and whether it is complete. When pages are missing, NAME them (e.g. EN "Pages 1, 2 and 4 of 4 are present; page 3 is missing." / FR "Les pages 1, 2 et 4 sur 4 sont présentes; la page 3 est manquante."). If a file could not be placed, say so honestly.
- conclusion_fr is plain Quebec French a non-expert reads comfortably: no jargon, no type codes, no percentages, never mention AI.
- confidence: 0 to 1, honest. Below 0.80 whenever unsure.
- outcome: the single routing verdict — "complete" when every page is present (a whole multi-page document, OR a complete single document, OR a set of separate complete documents like receipts), "incomplete" when a specific page is CONFIDENTLY missing, "unplaceable" when at least one file could not be confidently placed (the content chain did not lock — never guess, send it to the accountant), or "not_a_set" when the files are separate documents with no page sequence to complete. When you are not sure whether a page is missing or just unplaced, prefer "unplaceable" over "incomplete" — an honest "needs a human" beats a wrong "page missing".
- client_request_fr / client_request_en: ONLY when outcome is "incomplete", one short friendly sentence asking the CLIENT to send the specific missing page(s), in plain Quebec French and English (e.g. FR "Il manque la page 3 sur 4 de votre relevé bancaire. Pourriez-vous l'ajouter?"). No jargon, no codes, no percentages, never mention AI. Leave BOTH empty strings for any other outcome.
- flags: short, specific warnings ONLY when something needs the accountant's attention (a missing page, a file too blurry to read, a file unrelated to the request). Empty array when all is well.

Always answer through the ${SET_ASSESSMENT_TOOL.name} tool. Never reply with prose.`;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function computeFilesSignature(
  files: { id: string; content_hash: string | null }[],
): string[] {
  return files.map((f) => `${f.id}:${f.content_hash ?? ""}`).sort();
}

// ---------------------------------------------------------------------------
// Routing (piece 2): what to do once the set verdict is in
// ---------------------------------------------------------------------------

// A confidently-missing page only triggers the client-facing auto-ask above
// this bar — below it, the conservative choice is to send it to the accountant.
// Matches the per-file usability auto-act threshold (0.8) so the whole system
// uses one "confident enough to act" line.
export const SET_INCOMPLETE_CONFIDENCE_BAR = 0.8;

// A content-duplicate auto-fires (when the firm's auto_reject_duplicates is ON)
// only at or above this bar — deliberately high so a wrong auto-rejection is
// rare. Anything less confident is flagged for the accountant regardless of the
// setting. Tunable in one place.
export const DUPLICATE_AUTO_REJECT_CONFIDENCE = 0.9;

// Fallback client ask when the model leaves client_request empty on an
// incomplete set — generic but plain, so the client is never asked nothing.
export const DEFAULT_MISSING_PAGE_ASK_FR =
  "Il manque une ou des pages de ce document. Pourriez-vous les ajouter?";
export const DEFAULT_MISSING_PAGE_ASK_EN =
  "One or more pages of this document are missing. Could you please add them?";

// PURE: per-duplicate routing. A content duplicate auto-rejects only when the
// firm opted in AND the model is very confident; otherwise it is flagged for the
// accountant. Mirrors the duplicate-setting philosophy (auto-fire on the sure
// cases only). Exported for tests.
export function decideDuplicateAction(opts: {
  autoRejectDuplicates: boolean;
  confidence: number;
}): DuplicateDecision {
  return opts.autoRejectDuplicates &&
    opts.confidence >= DUPLICATE_AUTO_REJECT_CONFIDENCE
    ? "auto_reject"
    : "flag";
}

export type SetRoutingAction = "none" | "ask_client" | "flag_accountant";

// PURE routing decision (exported for tests). Mirrors the duplicate-setting
// philosophy: the automatic client-facing action fires ONLY on a confident
// 'incomplete' when the firm opted in; everything uncertain goes to the
// accountant. 'unplaceable' ALWAYS goes to the accountant — a guess is never
// sent to a client. 'complete'/'not_a_set' need no routing.
export function decideSetRouting(opts: {
  outcome: SetOutcome;
  confidence: number;
  autoRequestMissingPages: boolean;
}): SetRoutingAction {
  if (opts.outcome === "unplaceable") return "flag_accountant";
  if (opts.outcome === "incomplete") {
    if (opts.confidence < SET_INCOMPLETE_CONFIDENCE_BAR) {
      return "flag_accountant";
    }
    return opts.autoRequestMissingPages ? "ask_client" : "flag_accountant";
  }
  return "none";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Small positive integer or null — tolerates the model returning junk.
function posInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 999
    ? v
    : null;
}

function isPlacement(v: unknown): v is SetAssessmentPlacement {
  return v === "printed" || v === "inferred" || v === "unconfirmed";
}

// Tolerant parse of the raw model output, mirroring parseClassification's
// philosophy: clamp numbers, default malformed enums to the conservative
// value, drop entries that can't be anchored to a real file. Returns null only
// when there is no usable conclusion at all (treated as "no result" upstream).
export function parseSetAssessment(
  raw: Record<string, unknown>,
  orderedFileIds: string[],
): Pick<
  SetAssessment,
  | "conclusion_en"
  | "conclusion_fr"
  | "confidence"
  | "outcome"
  | "client_request_fr"
  | "client_request_en"
  | "pages"
  | "flags"
> | null {
  const en = str(raw.conclusion_en);
  const fr = str(raw.conclusion_fr);
  if (!en && !fr) return null;

  const seen = new Set<number>();
  const pages: SetAssessmentPage[] = [];
  if (Array.isArray(raw.pages)) {
    for (const p of raw.pages) {
      if (!p || typeof p !== "object") continue;
      const rec = p as Record<string, unknown>;
      const idx = rec.image_index;
      if (typeof idx !== "number" || !Number.isInteger(idx)) continue;
      // Out-of-range index = the model hallucinated a file; drop the entry.
      if (idx < 1 || idx > orderedFileIds.length) continue;
      if (seen.has(idx)) continue; // first entry per file wins
      seen.add(idx);
      // Content-duplicate: must point to an EARLIER file (strictly lower index)
      // so the earliest copy is always the keeper and the pair can never both be
      // marked. A forward/self/out-of-range pointer is ignored (treated unique).
      const dupRaw = rec.duplicate_of_image_index;
      const duplicate_of_file_id =
        typeof dupRaw === "number" &&
        Number.isInteger(dupRaw) &&
        dupRaw >= 1 &&
        dupRaw < idx
          ? orderedFileIds[dupRaw - 1]!
          : null;
      // Confidence only matters for a real duplicate; force 0 otherwise.
      const duplicate_confidence =
        duplicate_of_file_id && typeof rec.duplicate_confidence === "number"
          ? clamp01(rec.duplicate_confidence)
          : 0;
      pages.push({
        file_id: orderedFileIds[idx - 1]!,
        position: posInt(rec.position),
        of_total: posInt(rec.of_total),
        placement: isPlacement(rec.placement) ? rec.placement : "unconfirmed",
        note: (str(rec.note) ?? "").slice(0, 300),
        duplicate_of_file_id,
        duplicate_confidence,
      });
    }
  }

  const flags = Array.isArray(raw.flags)
    ? raw.flags
        .filter((f): f is string => typeof f === "string" && f.trim() !== "")
        .map((f) => f.trim().slice(0, 500))
        .slice(0, 12)
    : [];

  // Unknown / malformed outcome defaults to "unplaceable" — the conservative
  // choice (routes to the accountant), never a wrong "complete" or "missing".
  const outcome: SetOutcome = SET_OUTCOMES.includes(raw.outcome as SetOutcome)
    ? (raw.outcome as SetOutcome)
    : "unplaceable";

  // Client-facing ask is only meaningful for an incomplete set; force it empty
  // otherwise so a stray sentence never leaks to a client on a complete set.
  const clientFr =
    outcome === "incomplete" ? (str(raw.client_request_fr) ?? "").slice(0, 500) : "";
  const clientEn =
    outcome === "incomplete" ? (str(raw.client_request_en) ?? "").slice(0, 500) : "";

  return {
    // Mirror a missing language from the other so both are always present.
    conclusion_en: (en ?? fr ?? "").slice(0, 500),
    conclusion_fr: (fr ?? en ?? "").slice(0, 500),
    confidence:
      typeof raw.confidence === "number" ? clamp01(raw.confidence) : 0,
    outcome,
    // Mirror one language from the other when only one came back.
    client_request_fr: clientFr || clientEn,
    client_request_en: clientEn || clientFr,
    pages,
    flags,
  };
}

// ---------------------------------------------------------------------------
// The job worker
// ---------------------------------------------------------------------------

type FileRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  content_hash: string | null;
  uploaded_at: string;
};

type PreparedFile = {
  file: FileRow;
  isPdf: boolean;
  base64: string;
  mediaType: string;
};

export async function processSetAssessmentJob(
  payload: Record<string, unknown>,
): Promise<{
  skipped?: string;
  assessed?: {
    files: number;
    confidence: number;
    outcome: SetOutcome;
    routing: SetRoutingAction;
    duplicatesFlagged: number;
  };
}> {
  if (!isAiConfigured()) return { skipped: "ai_not_configured" };
  const itemId = String(payload.request_item_id ?? "");
  if (!itemId) return { skipped: "missing_item_id" };

  const sb = getServiceRoleSupabase();
  const { data: itemData } = await sb
    .from("request_items")
    .select(
      "id, engagement_id, label, label_fr, kind, ai_instructions, engagements!inner(firm_id, title, clients!inner(display_name, locale))",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (!itemData) return { skipped: "item_not_found" };

  type ClientCtx = { display_name?: string | null; locale?: string | null };
  type EngCtx = {
    firm_id?: string | null;
    title?: string | null;
    clients?: ClientCtx | ClientCtx[] | null;
  };
  type ItemRow = {
    id: string;
    engagement_id: string;
    label: string | null;
    label_fr: string | null;
    kind: string;
    ai_instructions: string | null;
    engagements: EngCtx | EngCtx[] | null;
  };
  const item = itemData as unknown as ItemRow;
  // Signature items never get AI (the upload is a signed copy, not a tax doc).
  if (item.kind === "signature") return { skipped: "signature_item" };
  const engRaw = item.engagements;
  const eng = Array.isArray(engRaw) ? engRaw[0] : engRaw;
  const firmId = eng?.firm_id ?? null;
  if (!firmId) return { skipped: "no_firm" };

  // Per-engagement "AI Analyze" toggle (migration 0340): mirror the per-file
  // gate so the set assessment never spends tokens on a disabled engagement
  // either. Fail-open (missing column / read error → ON). Terminal-done in the
  // cron (not in RETRYABLE_SET_SKIPS), so a disabled item's debounced job
  // settles to done instead of retrying.
  if (!(await isEngagementAiEnabled(sb, item.engagement_id))) {
    return { skipped: "engagement_ai_disabled" };
  }

  const clientRaw = eng?.clients;
  const client = Array.isArray(clientRaw) ? clientRaw[0] : clientRaw;

  // Cost guards — the same shape as classify: a daily per-firm rate bucket
  // (its own key, same generous ceiling) + the monthly cap with auto-pause.
  const rl = await checkRateLimit({
    key: `ai:assess:firm:${firmId}`,
    ...AI_CLASSIFY_PER_FIRM_DAILY,
  });
  if (!rl.ok) return { skipped: "firm_daily_quota_exceeded" };
  const usage = await getFirmAiUsage(firmId);
  if (usage.paused) {
    // Trial lifetime cap vs paid monthly cap — distinct codes; both terminal.
    return {
      skipped: usage.isTrial
        ? "trial_ai_limit_reached"
        : "firm_monthly_cap_exceeded",
    };
  }

  // The set: every non-duplicate file of the item, in upload order.
  const { data: fileRows } = await sb
    .from("uploaded_files")
    .select("id, storage_path, mime_type, content_hash, uploaded_at")
    .eq("request_item_id", itemId)
    .eq("is_duplicate", false)
    .order("uploaded_at", { ascending: true });
  const allFiles = (fileRows ?? []) as FileRow[];
  if (allFiles.length === 0) {
    // No files left to assess (all deleted, or all duplicates). Clear any prior
    // verdict so the engagement never shows a set summary for documents that
    // are gone — this is what makes the re-check after a deletion meaningful.
    await sb
      .from("request_items")
      .update({ ai_set_assessment: null })
      .eq("id", itemId);
    return { skipped: "no_files" };
  }

  const readable = allFiles.filter((f) =>
    isSupportedAiMime(f.mime_type ?? ""),
  );
  if (readable.length === 0) return { skipped: "no_supported_files" };

  // Download + prepare, bounded by file count and total bytes. Images get the
  // SAME prep as classify (2048px cap, JPEG q90); PDFs pass through untouched.
  const prepared: PreparedFile[] = [];
  let budget = 0;
  for (const f of readable) {
    if (prepared.length >= MAX_SET_FILES) break;
    const dl = await downloadStorageObject(f.storage_path);
    if (!dl) return { skipped: "download_failed" }; // transient — cron retries
    const mt = normalizeMimeType(f.mime_type || dl.mimeType);
    const isPdf = mt === "application/pdf";
    const prep = isPdf
      ? { bytes: dl.bytes, mimeType: mt }
      : await normalizeImageForAi(dl.bytes, mt);
    // Always include the first file, even alone over budget (same situation a
    // single-file classify handles today); stop before any later overflow.
    if (prepared.length > 0 && budget + prep.bytes.length > MAX_SET_BYTES) {
      break;
    }
    budget += prep.bytes.length;
    prepared.push({
      file: f,
      isPdf,
      base64: prep.bytes.toString("base64"),
      mediaType: prep.mimeType,
    });
  }

  const requestContext: SetRequestContext = {
    requestLabel: item.label ?? null,
    requestLabelFr: item.label_fr ?? null,
    clientName: client?.display_name ?? null,
    expectedYear: expectedYearFromTitle(eng?.title ?? ""),
    aiInstructions: item.ai_instructions ?? null,
  };
  const systemPrompt = buildSetSystemPrompt(requestContext, prepared.length);
  const requestedAs =
    requestContext.requestLabel?.trim() ||
    requestContext.requestLabelFr?.trim() ||
    "the requested document";
  const userText = `The accountant requested: "${requestedAs}". The ${prepared.length} file(s) above were uploaded by the client to this ONE checklist item, in upload order (File 1 was uploaded first). Assess them together as a set.`;

  let raw: Record<string, unknown> | null = null;
  const provider = getProvider();
  if (provider === "openai") {
    const model = getOpenAiModel();
    const { raw: r, usage: u } = await assessSetWithOpenAI({
      model,
      systemPrompt,
      userText,
      schemaName: SET_ASSESSMENT_TOOL.name,
      schema: SET_ASSESSMENT_TOOL.input_schema as unknown as Record<
        string,
        unknown
      >,
      files: prepared.map((p) => ({
        isPdf: p.isPdf,
        base64: p.base64,
        mediaType: p.mediaType,
      })),
    });
    raw = r;
    console.info(
      `[ai/assess-set] provider=openai model=${model} files=${prepared.length} in_tokens=${u?.input ?? "?"} out_tokens=${u?.output ?? "?"}${u?.reasoning != null ? ` reasoning_tokens=${u.reasoning}` : ""}`,
    );
  } else {
    raw = await assessSetWithAnthropic(systemPrompt, userText, prepared);
  }
  if (!raw) return { skipped: "no_result" }; // transient — cron retries

  const parsed = parseSetAssessment(
    raw,
    prepared.map((p) => p.file.id),
  );
  if (!parsed) return { skipped: "no_result" };

  // Coverage honesty: when the item held more files than one call can carry,
  // say so — silence would read as "everything was reviewed together".
  if (allFiles.length > prepared.length) {
    parsed.flags = [
      `Only the first ${prepared.length} of ${allFiles.length} files were reviewed together; the rest were not part of this assessment.`,
      ...parsed.flags,
    ].slice(0, 12);
  }

  // Staleness guard: if the set changed while the model was reading (new
  // upload, delete, duplicate promotion), DON'T write a verdict about files
  // that no longer represent the item — a new upload has already scheduled a
  // fresh job that will cover the new set.
  const { data: nowRows } = await sb
    .from("uploaded_files")
    .select("id")
    .eq("request_item_id", itemId)
    .eq("is_duplicate", false);
  const before = new Set(allFiles.map((f) => f.id));
  const nowIds = (nowRows ?? []).map((r) => r.id as string);
  if (nowIds.length !== before.size || nowIds.some((id) => !before.has(id))) {
    return { skipped: "set_changed" };
  }

  // Routing (piece 2) is computed BEFORE the write so its needs_client flag is
  // stored on the assessment — the item-status roll-up (piece B) reads it. A
  // confidently-missing page either auto-asks the client (firm opted in) or is
  // flagged for the accountant. The firm flag lives in a column added by
  // migration 0330 — read it resiliently so this is safe before that migration
  // is applied (a missing column → null → OFF).
  let autoRequestMissingPages = false;
  let autoRejectDuplicates = false;
  try {
    const { data: firmRow } = await sb
      .from("firms")
      .select("auto_request_missing_pages, auto_reject_duplicates")
      .eq("id", firmId)
      .maybeSingle();
    autoRequestMissingPages = Boolean(firmRow?.auto_request_missing_pages);
    autoRejectDuplicates = Boolean(firmRow?.auto_reject_duplicates);
  } catch {
    // pre-0330 / transient — default OFF (accountant), never block on it.
  }
  const routing = decideSetRouting({
    outcome: parsed.outcome,
    confidence: parsed.confidence,
    autoRequestMissingPages,
  });

  const assessment: SetAssessment = {
    ...parsed,
    // The item is "waiting on the client" only when we're actually asking the
    // client (confident incomplete + firm opted in). Anything routed to the
    // accountant leaves the item in its normal review flow.
    needs_client: routing === "ask_client",
    assessed_at: new Date().toISOString(),
    files_signature: computeFilesSignature(
      prepared.map((p) => ({
        id: p.file.id,
        content_hash: p.file.content_hash,
      })),
    ),
  };

  // Loud on purpose: if the 0320 column is missing this throws, the job
  // retries, and the failure is visible in the jobs table — never a silent
  // "assessment ran but vanished".
  const { error: writeErr } = await sb
    .from("request_items")
    .update({ ai_set_assessment: assessment })
    .eq("id", itemId);
  if (writeErr) throw writeErr;

  // One real set call ran — bill ONE unit, same meter as classify.
  await incrementFirmAiUsage(firmId);

  // Content-aware duplicates: the set review pointed each later copy at the
  // earlier file it duplicates. Route each through the SAME machinery as the
  // byte-identical detector. Phase 5: when the firm's auto_reject_duplicates is
  // ON, a VERY confident duplicate auto-rejects (with the existing "already
  // sent" message); anything less confident is flagged for the accountant
  // regardless of the setting. Done BEFORE the status recompute so the roll-up
  // excludes them.
  const clientLocale: "fr" | "en" = client?.locale === "en" ? "en" : "fr";
  let duplicatesFlagged = 0;
  let duplicatesAutoRejected = 0;
  for (const page of assessment.pages) {
    if (!page.duplicate_of_file_id) continue;
    const decision = decideDuplicateAction({
      autoRejectDuplicates,
      confidence: page.duplicate_confidence,
    });
    await applyDuplicateDecision({
      supabase: sb,
      decision,
      fileId: page.file_id,
      originalFileId: page.duplicate_of_file_id,
      requestItemId: itemId,
      engagementId: item.engagement_id,
      firmId,
      clientLocale,
    });
    duplicatesFlagged += 1;
    if (decision === "auto_reject") duplicatesAutoRejected += 1;
  }

  // Re-derive the item status now the verdict is in: a needs_client set keeps
  // the item "waiting on the client" (a rejected-equivalent roll-up); a
  // now-complete set lets it return to its file-derived status. Also reflects
  // any duplicates just set aside. Reads the assessment we just wrote.
  await recomputeItemStatus(sb, itemId);

  // PII-free metadata (no filenames, no conclusions — they can name people).
  await sb.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: item.engagement_id,
    actor_type: "system",
    action: "ai_set_assessed",
    metadata: {
      request_item_id: itemId,
      file_count: prepared.length,
      confidence: assessment.confidence,
      outcome: assessment.outcome,
      flag_count: assessment.flags.length,
      duplicates_flagged: duplicatesFlagged,
      duplicates_auto_rejected: duplicatesAutoRejected,
    },
  });

  if (routing === "ask_client") {
    // Reuse the existing client-retry notifier (email always, SMS with the
    // 30-min anti-spam) with the set's plain-French missing-page ask. The
    // worker is already item-level; uploaded_file_id is intentionally omitted.
    await enqueueJob({
      kind: "notify_client_retry",
      payload: {
        request_item_id: itemId,
        engagement_id: item.engagement_id,
        issue_summary_fr:
          assessment.client_request_fr || DEFAULT_MISSING_PAGE_ASK_FR,
        issue_summary_en:
          assessment.client_request_en || DEFAULT_MISSING_PAGE_ASK_EN,
      },
      runAfter: new Date(),
    });
  }

  return {
    assessed: {
      files: prepared.length,
      confidence: assessment.confidence,
      outcome: assessment.outcome,
      routing,
      duplicatesFlagged,
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic path (OpenAI's lives in openai-classify.ts beside its sibling)
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic | null {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") return null;
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

async function assessSetWithAnthropic(
  systemPrompt: string,
  userText: string,
  files: { isPdf: boolean; base64: string; mediaType: string }[],
): Promise<Record<string, unknown> | null> {
  const c = anthropicClient();
  if (!c) return null;

  type ContentBlock =
    | {
        type: "document";
        source: { type: "base64"; media_type: "application/pdf"; data: string };
      }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
    | { type: "text"; text: string };

  const content: ContentBlock[] = [];
  files.forEach((f, i) => {
    content.push({ type: "text", text: `File ${i + 1} of ${files.length}:` });
    content.push(
      f.isPdf
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: f.base64,
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: f.mediaType,
              data: f.base64,
            },
          },
    );
  });
  content.push({ type: "text", text: userText });

  const resp = await c.messages.create(
    {
      model: ANTHROPIC_MODEL,
      // Roomier than the single-doc classify cap: pages[] grows with the set.
      max_tokens: 2000,
      system: systemPrompt,
      tools: [SET_ASSESSMENT_TOOL as never],
      tool_choice: { type: "tool", name: SET_ASSESSMENT_TOOL.name },
      messages: [{ role: "user", content: content as never }],
    },
    // Same bound as classify: fail cleanly inside the worker budget and let
    // the durable job retry, rather than hang the cron run.
    { timeout: 40_000, maxRetries: 1 },
  );

  console.info(
    `[ai/assess-set] provider=anthropic model=${ANTHROPIC_MODEL} files=${files.length} in_tokens=${resp.usage?.input_tokens ?? "?"} out_tokens=${resp.usage?.output_tokens ?? "?"}`,
  );

  for (const block of resp.content) {
    if (block.type === "tool_use" && block.name === SET_ASSESSMENT_TOOL.name) {
      return block.input as Record<string, unknown>;
    }
  }
  return null;
}
