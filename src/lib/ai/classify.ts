// Document classifier using Anthropic Claude.
//
// The model identifies what kind of slip/document the client uploaded and
// flags mismatches against the request item's expected doc_type. The
// accountant always has the final word — AI is advisory only.

import Anthropic from "@anthropic-ai/sdk";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { DocType } from "@/lib/db/templates";
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

const KNOWN_DOC_TYPES: DocType[] = [
  "t4", "rl1", "t5", "rl3", "t3", "rl16", "noa",
  "bank_statement", "credit_card_statement", "receipt",
  "t2202", "rrsp", "medical", "donation", "rental",
  "gst_hst_qst", "trial_balance", "gl_export", "financials",
  "shareholder_loan", "payroll_summary", "capital_asset",
  "inventory", "invoice", "other",
];

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
          "How confident the classification is. Use <0.5 for unfamiliar or hard-to-read documents.",
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
          "How confident the usability verdict is. Use <0.80 when uncertain — Relai only auto-acts at >=0.80.",
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
- t4 = T4 federal employment income slip
- rl1 = Quebec RL-1 (provincial T4 equivalent)
- t5 = T5 federal investment income slip
- rl3 = Quebec RL-3
- t3 = T3 federal trust income slip
- rl16 = Quebec RL-16
- t2202 = T2202 tuition slip
- noa = Notice of Assessment from CRA
- bank_statement = monthly bank statement
- credit_card_statement = monthly credit card statement
- receipt = generic expense receipt
- rrsp = RRSP contribution slip
- medical = medical receipt
- donation = donation receipt
- rental = rental property income/expense summary
- gst_hst_qst = sales tax filing
- trial_balance, gl_export, financials, shareholder_loan = corporate accounting docs
- payroll_summary, capital_asset, inventory, invoice = other business docs
- other = anything else
- unknown = can't tell

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
uncertain — Relai only auto-acts above that threshold.

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
    max_tokens: 512,
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
