// Document classifier using Anthropic Claude.
//
// The model identifies what kind of slip/document the client uploaded and
// flags mismatches against the request item's expected doc_type. The
// accountant always has the final word — AI is advisory only.

import Anthropic from "@anthropic-ai/sdk";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { DocType } from "@/lib/db/templates";
import { DOC_TYPES, DOC_TYPE_LABELS } from "@/lib/doc-types";
import {
  USABILITY_ISSUES,
  USABLE_BY_DEFAULT,
  isUsabilityIssue,
  type UsabilityVerdict,
} from "./usability";

const MODEL = "claude-sonnet-4-6";

export type ClassificationResult = {
  document_type: DocType | "unknown";
  confidence: number;
  // Phase 2: the model's own reasoning + the literal identifying text it read
  // (so the accountant can see WHY), and an honest runner-up type when the
  // document is genuinely ambiguous — never a coin-flip dressed as certainty.
  reasoning: string;
  key_identifiers: string[];
  second_guess: { document_type: DocType; confidence: number } | null;
  extracted_year: number | null;
  extracted_amount_or_total: number | null;
  looks_correct: boolean;
  issue_if_any: string | null;
  usability: UsabilityVerdict;
};

let _client: Anthropic | null = null;
function client(): Anthropic | null {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// Every doc type Vylan recognizes — derived from the single source of truth in
// @/lib/doc-types so the classifier can never fall behind the picker.
const KNOWN_DOC_TYPES: DocType[] = DOC_TYPES;

const CLASSIFY_TOOL = {
  name: "classify_document",
  description:
    "Return a structured classification of a Canadian tax / accounting document.",
  input_schema: {
    type: "object" as const,
    properties: {
      document_type: {
        type: "string",
        enum: [...KNOWN_DOC_TYPES, "unknown"],
        description: "Best guess at what this document is.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Confidence in document_type. Use >0.85 only when the form's title or identifier is clearly legible; 0.5-0.85 when the layout strongly suggests the type but the title isn't fully readable; <0.5 when genuinely unsure (and fill second_guess_type).",
      },
      reasoning: {
        type: "string",
        description:
          "One short sentence naming the strongest evidence for document_type — ideally the form title/identifier you actually read (e.g. \"title reads 'T4 Statement of Remuneration Paid'\").",
      },
      key_identifiers: {
        type: "array",
        items: { type: "string" },
        description:
          "The exact distinguishing text you READ on the document that pins the type down — e.g. [\"Relevé 1\", \"Revenus d'emploi\"] or [\"T4\", \"Statement of Remuneration Paid\", \"Box 14\"]. Empty array if no identifying text is legible.",
      },
      second_guess_type: {
        type: ["string", "null"],
        description:
          "When you are torn between two types, the SECOND most likely doc-type code from the reference list (e.g. 't4a' when you picked 't4'). Null when you are confident.",
      },
      second_guess_confidence: {
        type: ["number", "null"],
        minimum: 0,
        maximum: 1,
        description:
          "Confidence (0-1) in second_guess_type, or null when there is no second guess.",
      },
      extracted_year: {
        type: ["integer", "null"],
        description:
          "The tax year printed on the document (e.g. 2024), or null if not visible.",
      },
      extracted_amount_or_total: {
        type: ["number", "null"],
        description:
          "The headline dollar amount on the document if there is one (e.g. T4 box 14 'Employment income'), in CAD. Null if there's no obvious headline figure.",
      },
      looks_correct: {
        type: "boolean",
        description:
          "True if the document type matches what the accountant requested. False if it appears to be the wrong document.",
      },
      issue_if_any: {
        type: ["string", "null"],
        description:
          "A short bilingual-safe note explaining the mismatch if looks_correct is false, or any concern (illegible, wrong year, multiple slips in one file). Null if nothing's wrong.",
      },
      usable: {
        type: "boolean",
        description:
          "True if a real accountant would accept this document as-is. False only if it would clearly be sent back for re-upload. Borderline cases (mildly blurry but readable) must be TRUE.",
      },
      usability_confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How confident the usability verdict is. Use <0.80 when uncertain — Vylan only auto-acts at >=0.80.",
      },
      primary_issue: {
        type: ["string", "null"],
        enum: [...USABILITY_ISSUES, null],
        description:
          "The single biggest reason the document is unusable. Null when usable.",
      },
      all_issues: {
        type: "array",
        items: { type: "string", enum: [...USABILITY_ISSUES] },
        description:
          "All issues present. Empty array when usable.",
      },
      issue_summary_fr: {
        type: "string",
        description:
          "One short sentence in French explaining what is wrong, written for the client. Specific (e.g. 'le montant à droite est coupé') not generic ('image floue'). Empty string when usable.",
      },
      issue_summary_en: {
        type: "string",
        description:
          "One short sentence in English explaining what is wrong, written for the client. Specific (e.g. 'the amount on the right is cut off') not generic ('blurry image'). Empty string when usable.",
      },
    },
    required: [
      "document_type",
      "confidence",
      "reasoning",
      "key_identifiers",
      "second_guess_type",
      "second_guess_confidence",
      "extracted_year",
      "extracted_amount_or_total",
      "looks_correct",
      "issue_if_any",
      "usable",
      "usability_confidence",
      "primary_issue",
      "all_issues",
      "issue_summary_fr",
      "issue_summary_en",
    ],
  },
};

function buildSystemPrompt(expected: DocType): string {
  return `You are a document classifier for a small Canadian accounting firm.

The accountant requested a "${expected}" document from the client. The client just uploaded what you're about to see.

Canadian tax document reference (use these exact identifiers):
${DOC_TYPES.map((c) => `- ${c} = ${DOC_TYPE_LABELS[c].ai}`).join("\n")}
- unknown = can't tell

Identify the document by READING its title and form identifier first, not by
guessing from layout. Watch these commonly-confused pairs:
- t4 vs t4a: "Statement of Remuneration Paid" (employment, box 14) = t4;
  "Statement of Pension, Retirement, Annuity, and Other Income" = t4a.
- t4 vs rl1 (and t5 vs rl3, t3 vs rl16, …): a CRA federal slip = the T-slip; a
  Revenu Québec slip headed "Relevé 1 / Revenus d'emploi…" = the RL slip. The
  relevés (RL-#) are provincial; the T-slips are federal.
- t4a_p (RPC/RRQ benefits) vs t4a_oas (Old Age Security) vs t4a (general).
- rrsp (a contribution RECEIPT — money paid IN) vs t4rsp (RRSP income — money
  taken OUT).
- bank_statement vs credit_card_statement: a credit-card statement shows a
  credit limit, a minimum payment, and a card number; a bank statement shows an
  account balance with deposits and withdrawals.
- Read the TAX YEAR printed on the document carefully — a 2023 slip is not a
  2024 slip.

If two types are genuinely plausible, pick the more likely one but LOWER the
confidence and fill second_guess_type / second_guess_confidence. Never present a
coin-flip as a confident answer. Use "unknown" only when you truly cannot tell.

After identifying the document type, also assess whether this document is
USABLE for an accountant. A document is usable if all key information is
clearly readable. Mark it unusable if ANY of the following are true:

- text_unreadable: blur, low resolution, or pixelation makes key text
  illegible
- key_fields_obscured: important fields (amounts, names, dates, account
  numbers) are covered, scratched out, or missing
- partial_capture: the document is cut off — edges missing, only part
  of a page visible
- glare_or_shadow: reflections, bright spots, or shadows obscure
  important content
- wrong_document_type: the document is clearly not what was expected
  (e.g., a screenshot of a payment app where a T4 was requested)
- corrupt_or_blank: the file appears blank, corrupted, or contains no
  meaningful document content
- other: a usability issue that doesn't match the categories above

If the document is borderline (mildly blurry but readable), prefer USABLE.
Only mark UNUSABLE if a human accountant would clearly reject it.

Return a usability_confidence between 0 and 1. Use <0.80 when you are
uncertain — Vylan only auto-acts above that threshold.

When unusable, write issue_summary_fr and issue_summary_en as one short,
friendly, SPECIFIC sentence written for the client. The client will read
the exact words. Prefer "the right-side amount is cut off" over generic
phrasing like "blurry image".

Always call the classify_document tool. Never reply with prose.`;
}

export async function classifyDocument(opts: {
  expectedDocType: DocType;
  fileBytes: Buffer;
  mimeType: string;
}): Promise<ClassificationResult | null> {
  const c = client();
  if (!c) {
    console.warn("[ai/classify] ANTHROPIC_API_KEY not set — skipping");
    return null;
  }

  const base64 = opts.fileBytes.toString("base64");
  const isPdf = opts.mimeType === "application/pdf";
  const isImage = opts.mimeType.startsWith("image/");
  if (!isPdf && !isImage) {
    return {
      document_type: "unknown",
      confidence: 0,
      reasoning: "",
      key_identifiers: [],
      second_guess: null,
      extracted_year: null,
      extracted_amount_or_total: null,
      looks_correct: false,
      issue_if_any: "Unsupported file format for AI classification.",
      usability: USABLE_BY_DEFAULT,
    };
  }

  type ContentBlock =
    | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    | { type: "text"; text: string };

  const content: ContentBlock[] = isPdf
    ? [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
        },
        {
          type: "text",
          text: `The accountant requested a "${opts.expectedDocType}". Classify this document.`,
        },
      ]
    : [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: opts.mimeType,
            data: base64,
          },
        },
        {
          type: "text",
          text: `The accountant requested a "${opts.expectedDocType}". Classify this document.`,
        },
      ];

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: buildSystemPrompt(opts.expectedDocType),
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_document" },
    // sdk types are strict but the SDK accepts this content shape at runtime
    messages: [{ role: "user", content: content as never }],
  });

  for (const block of resp.content) {
    if (block.type === "tool_use" && block.name === "classify_document") {
      return parseClassification(block.input as Record<string, unknown>);
    }
  }
  return null;
}

export function parseClassification(
  raw: Record<string, unknown>,
): ClassificationResult | null {
  const doc = raw.document_type;
  const conf = raw.confidence;
  if (typeof doc !== "string") return null;
  if (typeof conf !== "number") return null;
  return {
    document_type: (KNOWN_DOC_TYPES as string[]).includes(doc)
      ? (doc as DocType)
      : "unknown",
    confidence: Math.max(0, Math.min(1, conf)),
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning.trim() : "",
    key_identifiers: Array.isArray(raw.key_identifiers)
      ? raw.key_identifiers
          .filter((x): x is string => typeof x === "string" && x.trim() !== "")
          .map((x) => x.trim())
      : [],
    second_guess: parseSecondGuess(raw),
    extracted_year:
      typeof raw.extracted_year === "number" ? raw.extracted_year : null,
    extracted_amount_or_total:
      typeof raw.extracted_amount_or_total === "number"
        ? raw.extracted_amount_or_total
        : null,
    looks_correct: raw.looks_correct === true,
    issue_if_any:
      typeof raw.issue_if_any === "string" && raw.issue_if_any.trim() !== ""
        ? raw.issue_if_any.trim()
        : null,
    usability: parseUsability(raw),
  };
}

// The model's runner-up type when it's torn. Kept only when second_guess_type
// is a REAL doc code (not "unknown" or junk) AND a numeric confidence came
// back — so a half-filled guess never surfaces as a phantom alternative.
function parseSecondGuess(
  raw: Record<string, unknown>,
): { document_type: DocType; confidence: number } | null {
  const t = raw.second_guess_type;
  const c = raw.second_guess_confidence;
  if (typeof t !== "string" || typeof c !== "number") return null;
  if (!(KNOWN_DOC_TYPES as string[]).includes(t)) return null;
  return { document_type: t as DocType, confidence: Math.max(0, Math.min(1, c)) };
}

// Tolerant parser for the usability sub-object. Anything malformed
// collapses to USABLE_BY_DEFAULT so a flaky AI response can never
// auto-reject a clean file. all_issues drops unknown values rather
// than rejecting the whole result.
function parseUsability(raw: Record<string, unknown>): UsabilityVerdict {
  // Required: usable + usability_confidence. Without these we
  // fall back to the safe default.
  if (typeof raw.usable !== "boolean") return USABLE_BY_DEFAULT;
  if (typeof raw.usability_confidence !== "number") return USABLE_BY_DEFAULT;

  const primary = raw.primary_issue;
  const all = raw.all_issues;
  const summaryFr = raw.issue_summary_fr;
  const summaryEn = raw.issue_summary_en;

  return {
    usable: raw.usable,
    confidence: Math.max(0, Math.min(1, raw.usability_confidence)),
    primary_issue: isUsabilityIssue(primary) ? primary : null,
    all_issues: Array.isArray(all) ? all.filter(isUsabilityIssue) : [],
    issue_summary_fr: typeof summaryFr === "string" ? summaryFr.trim() : "",
    issue_summary_en: typeof summaryEn === "string" ? summaryEn.trim() : "",
  };
}

// Fetch uploaded file bytes from Supabase storage by signed-URL fetch.
export async function downloadStorageObject(path: string): Promise<{
  bytes: Buffer;
  mimeType: string;
} | null> {
  const sb = getServiceRoleSupabase();
  const { data: signed } = await sb.storage
    .from("client-uploads")
    .createSignedUrl(path, 60);
  if (!signed?.signedUrl) return null;
  const res = await fetch(signed.signedUrl);
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes, mimeType };
}
