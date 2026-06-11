// Document classifier using Anthropic Claude.
//
// The model identifies what kind of slip/document the client uploaded and
// flags mismatches against the request item's expected doc_type. The
// accountant always has the final word — AI is advisory only.

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { DocType } from "@/lib/db/templates";
import { DOC_TYPES, DOC_TYPE_LABELS } from "@/lib/doc-types";
import {
  USABILITY_ISSUES,
  USABLE_BY_DEFAULT,
  USABILITY_CONFIDENCE_THRESHOLD,
  isUsabilityIssue,
  type UsabilityIssue,
  type UsabilityVerdict,
} from "./usability";
import { classifyWithOpenAI, isOpenAiConfigured } from "./openai-classify";

const MODEL = "claude-sonnet-4-6";

// Which AI runs the classifier. Defaults to Anthropic (Claude); set
// AI_CLASSIFIER_PROVIDER=openai to use GPT-5 Mini instead. Read per-call so the
// provider can be flipped (and reverted) via env with no code change.
function getProvider(): "anthropic" | "openai" {
  return process.env.AI_CLASSIFIER_PROVIDER?.toLowerCase() === "openai"
    ? "openai"
    : "anthropic";
}

// The OpenAI model id, overridable via env (e.g. "gpt-5.4-mini").
function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
}

// Anthropic's vision sweet spot — images past this are downscaled by the API
// anyway, so capping here is accuracy-neutral while cutting the upload payload
// and token cost (a phone photo is often 3000-4000px on the long edge).
const MAX_IMAGE_EDGE = 1568;

// Downscale an oversized image (and honour EXIF rotation) before it goes to the
// model. Fail-soft: ANY error falls back to the original bytes so analysis
// never breaks on a quirky file. PDFs are never passed here.
async function normalizeImageForAi(
  bytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  try {
    const img = sharp(bytes, { failOn: "none" });
    const meta = await img.metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    const isStandard = mimeType === "image/jpeg" || mimeType === "image/png";
    const tooBig = longest > MAX_IMAGE_EDGE;

    // Already a standard format (jpeg/png) and not oversized → send as-is.
    if (isStandard && !tooBig) {
      return { bytes, mimeType };
    }

    // Otherwise re-encode to JPEG (downscaling if oversized). This converts
    // webp/heic/etc. — which GPT-5 misreads or misclassifies when sent as-is (a
    // real T4 .webp came back as "not a T4" until converted) — into a format the
    // vision models read reliably, and caps oversized phone photos.
    let pipeline = img.rotate();
    if (tooBig) {
      pipeline = pipeline.resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    const out = await pipeline.jpeg({ quality: 82 }).toBuffer();
    return { bytes: out, mimeType: "image/jpeg" };
  } catch (e) {
    console.warn("[ai/classify] image normalize failed, using original:", e);
    return { bytes, mimeType };
  }
}

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
  // Phase 3: key fields read off the document (null when not legible). These
  // power the expected-vs-actual matching in Phase 4.
  document_date: string | null;
  issuer_name: string | null;
  party_name: string | null;
  account_or_period: string | null;
  form_identifier: string | null;
  amounts: { label: string; value: number }[];
  fields_confidence: number;
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

function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function isAiConfigured(): boolean {
  return getProvider() === "openai"
    ? isOpenAiConfigured()
    : isAnthropicConfigured();
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
      document_date: {
        type: ["string", "null"],
        description:
          "The date printed on the document (issue or statement date) as an ISO date (YYYY-MM-DD) when possible, else as printed. Null if none is visible.",
      },
      issuer_name: {
        type: ["string", "null"],
        description:
          "Who issued the document — the employer/payer on a slip, the financial institution on a statement, or 'CRA' / 'Revenu Québec' on an assessment. Null if not visible.",
      },
      party_name: {
        type: ["string", "null"],
        description:
          "The person or business the document is ABOUT — the named taxpayer, employee, or account holder. Used later to confirm the document belongs to the right client. Null if not visible. If the name is covered/redacted/blacked-out, return null here (do NOT describe the redaction) and set owner_identifiable to false.",
      },
      owner_identifiable: {
        type: "boolean",
        description:
          "Can you clearly READ the name of the person or business this document is about (employee, recipient, taxpayer, account holder, or company)? Return false if that name is missing, blank, covered, blacked out, redacted, scribbled over, or otherwise not clearly legible. A document whose owner cannot be identified must be treated as unusable.",
      },
      key_values_obscured: {
        type: "boolean",
        description:
          "Is ANY of the document's DEFINING numbers/values blacked out, scribbled over, taped/whited out, redacted, covered, cut off, or otherwise unreadable — e.g. the bank ACCOUNT / transit / institution number on a void cheque or direct-deposit form, the account number or balances on a statement, the box amounts on a tax slip, the figures on an assessment? Return true even if the rest of the page is perfectly clear and even if the client redacted it deliberately. Do NOT return true for incidental marks that don't touch the document's own key values. A document whose defining numbers are obscured must be treated as unusable.",
      },
      account_or_period: {
        type: ["string", "null"],
        description:
          "For statements, the statement period (e.g. 'Jan 1 - Jan 31, 2024'); for slips, an account/policy reference if shown. Null if none.",
      },
      form_identifier: {
        type: ["string", "null"],
        description:
          "The form code/number printed on the document (e.g. 'T4', 'RL-1', 'FPZ-500'). Null if none.",
      },
      amounts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description:
                "What the figure is (e.g. 'Box 14 employment income', 'Statement closing balance').",
            },
            value: { type: "number", description: "The amount in CAD." },
          },
          required: ["label", "value"],
        },
        description:
          "The 1-5 most important labelled dollar amounts on the document. Empty array if none are legible.",
      },
      fields_confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How confident you are in the EXTRACTED FIELD VALUES above (separate from document_type confidence). Use <0.5 when the values were hard to read.",
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
      "document_date",
      "issuer_name",
      "party_name",
      "owner_identifiable",
      "key_values_obscured",
      "account_or_period",
      "form_identifier",
      "amounts",
      "fields_confidence",
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

// What the accountant actually asked for, in words — the checklist item's
// label (and the engagement's client/year when known). Without this the model
// only saw a doc-type CODE; for free-form items (doc_type "other", e.g.
// "Void cheque (direct deposit)") that code carries no meaning, so a clearly
// wrong upload (a driver's licence under a void-cheque request) sailed
// through as "quality looks good" and was never auto-bounced.
export type RequestContext = {
  requestLabel?: string | null;
  requestLabelFr?: string | null;
  clientName?: string | null;
  expectedYear?: number | null;
};

export function buildSystemPrompt(
  expected: DocType,
  ctx: RequestContext = {},
): string {
  const label = ctx.requestLabel?.trim() || ctx.requestLabelFr?.trim() || null;
  const requestLines = [
    label
      ? `The accountant asked the client for: "${label}"${
          ctx.requestLabelFr?.trim() && ctx.requestLabelFr.trim() !== label
            ? ` (French label: "${ctx.requestLabelFr.trim()}")`
            : ""
        }.`
      : null,
    expected !== "other"
      ? `The expected document type code is "${expected}".`
      : label
        ? `No specific tax-form code was set for this item — judge the upload against the request wording above.`
        : `The accountant requested a "${expected}" document.`,
    ctx.clientName?.trim()
      ? `The engagement's client is: ${ctx.clientName.trim()}.`
      : null,
    ctx.expectedYear != null
      ? `The engagement concerns tax year ${ctx.expectedYear}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a document classifier for a small Canadian accounting firm.

${requestLines}
The client just uploaded what you're about to see.

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

Also EXTRACT the document's key fields, reading them straight off the page —
null anything you cannot read clearly:
- document_date — the date printed on it (issue or statement date).
- issuer_name — who issued it (employer/payer on a slip, the bank on a
  statement, "CRA" / "Revenu Québec" on an assessment).
- party_name — the person or business the document is ABOUT (the named
  taxpayer, employee, or account holder).
- account_or_period — the statement period for statements, or an account
  reference.
- form_identifier — the form code printed on it (e.g. "T4", "RL-1").
- amounts — the 1-5 most important labelled dollar figures.
Set fields_confidence from how legible those values were.

After identifying the document type, also assess whether this document is
USABLE for an accountant. A document is usable if all key information is
clearly readable. Mark it unusable if ANY of the following are true:

- text_unreadable: blur, low resolution, or pixelation makes key text
  illegible
- key_fields_obscured: important fields (amounts, names, dates, account
  numbers) are covered, scratched out, redacted, blacked out, or missing.
  This ALWAYS includes the case where the NAME of the person or business the
  document is about (employee, recipient, taxpayer, account holder) is covered,
  redacted, scribbled over, or unreadable — Vylan cannot accept a document when
  it cannot confirm whose it is.
- partial_capture: the document is cut off — edges missing, only part
  of a page visible
- glare_or_shadow: reflections, bright spots, or shadows obscure
  important content
- wrong_document_type: the document clearly CANNOT satisfy what the
  accountant asked for, judged against the request wording above (e.g. a
  driver's licence or a payment-app screenshot where a void cheque was
  requested; a restaurant receipt where a T4 was requested). Apply this even
  when no tax-form code was set — the request wording is the contract.
  Guardrails, because a false bounce nags an innocent client:
  * A name that differs from the client's is NOT, by itself,
    wrong_document_type — spouses, dependants, and businesses legitimately
    appear on requested documents (a dependant's birth certificate under
    "Dependant information" is CORRECT).
  * An older tax year is NOT, by itself, wrong_document_type — prior-year
    documents are often exactly what was asked (a prior-year Notice of
    Assessment). Only treat the year as disqualifying when the request
    explicitly names a year AND the document is a year-specific slip for a
    different year.
  * When the document plausibly satisfies the request but you have doubts,
    leave it usable and express the doubt via looks_correct/issue_if_any —
    the accountant reviews those.
  * When it clearly cannot satisfy the request (like an identity card in
    place of a banking document), mark wrong_document_type with high
    confidence so the client is asked to re-send the right thing now, not
    days later.
- corrupt_or_blank: the file appears blank, corrupted, or contains no
  meaningful document content
- wrong_orientation: the page is sideways or upside-down AND that makes the
  text hard to read. A readable rotated page is USABLE (the accountant can
  rotate it) — flag this only when orientation genuinely impairs reading.
- password_protected: the file is locked / encrypted and its contents can't
  be read; an unlocked copy is needed.
- missing_pages: the document clearly has more pages than were provided (e.g.
  "Page 1 of 3" with only one page, or a statement cut off mid-table).
- screenshot_of_screen: this is a PHOTO of a monitor or phone screen (visible
  bezel, glare, or moiré) rather than the document itself, and that impairs
  reading. A clean digital screenshot of the actual document is USABLE.
- other: a usability issue that doesn't match the categories above

If the document is borderline (mildly blurry but readable), prefer USABLE.
Only mark UNUSABLE if a human accountant would clearly reject it.

IDENTITY IS A HARD EXCEPTION to that leniency. You must be able to read
the name of the person or business the document is about. Set owner_identifiable
to false whenever that name is missing, blank, covered, blacked out, redacted,
or scribbled over. When owner_identifiable is false you MUST also set
usable=false, primary_issue=key_fields_obscured, set party_name to null (do not
describe the redaction in party_name), and use a usability_confidence of at
least 0.85 — a document whose owner cannot be confirmed is never acceptable,
even if everything else on it is perfectly legible.

OBSCURED KEY NUMBERS ARE THE SECOND HARD EXCEPTION. A document exists to convey
specific values, and if those are hidden the document is worthless no matter how
clean the rest of the page is. A void cheque or direct-deposit form exists to
convey the bank ACCOUNT, TRANSIT, and INSTITUTION numbers; a bank or credit-card
statement its account number and balances; a tax slip its box amounts; a Notice
of Assessment its figures. Set key_values_obscured to true whenever ANY of those
DEFINING numbers is blacked out, scribbled over, taped or whited out, redacted,
covered, cut off, or otherwise unreadable — EVEN IF everything else is perfectly
legible, and EVEN IF the client clearly redacted it on purpose to "protect"
their information. When key_values_obscured is true you MUST also set
usable=false, primary_issue=key_fields_obscured, and a usability_confidence of
at least 0.85. A void cheque with a blacked-out account number is useless and
must be sent back. (Do NOT trip this for incidental marks that don't touch the
document's own defining values.)

For financial statements (trial balance, income statement, balance sheet,
general ledger), the owner is the COMPANY named in the header — read it into
party_name. Whenever you CAN identify the real owner, ALWAYS copy that exact
name into party_name; never leave party_name blank if a real name is legible.
Obvious placeholder / sample / template names (e.g. "Sample Company",
"Example", "John Doe", "Test", a generic "You") do NOT identify a real owner —
treat them as missing: set party_name to null and owner_identifiable to false.

Return a usability_confidence between 0 and 1. Use <0.80 when you are
uncertain — Vylan only auto-acts above that threshold.

When unusable, write issue_summary_fr and issue_summary_en as one short,
friendly, SPECIFIC sentence written for the client. The client will read
the exact words. Prefer "the right-side amount is cut off" over generic
phrasing like "blurry image". For wrong_document_type, NAME what was
requested in plain words (e.g. FR "Nous avons besoin d'un spécimen de
chèque — ce document semble être un permis de conduire." / EN "We need a
void cheque — this looks like a driver's licence."). Never mention AI,
codes, or confidence to the client.

Always call the classify_document tool. Never reply with prose.`;
}

// The bare media type — strip an optional "; charset=…" parameter and
// lowercase before matching. The MIME can arrive from a storage CDN header as
// e.g. "application/pdf; charset=binary" (or even "application/octet-stream"),
// which made PDFs silently fail the "=== application/pdf" guard and skip the
// AI check entirely. Exported for testing.
export function normalizeMimeType(mime: string): string {
  return (mime || "").split(";")[0]!.trim().toLowerCase();
}

// Can Vylan's vision model read this file at all? PDF or any image.
export function isSupportedAiMime(mime: string): boolean {
  const mt = normalizeMimeType(mime);
  return mt === "application/pdf" || mt.startsWith("image/");
}

export async function classifyDocument(opts: {
  expectedDocType: DocType;
  fileBytes: Buffer;
  mimeType: string;
  // The request in words (checklist label + engagement client/year) — lets
  // the model judge "is this even the requested document" for free-form
  // items whose doc-type code ("other") says nothing. Optional so existing
  // callers/tests keep working; without it the model falls back to the
  // code-only behavior.
  request?: RequestContext;
}): Promise<ClassificationResult | null> {
  const mt = normalizeMimeType(opts.mimeType);
  const isPdf = mt === "application/pdf";
  const isImage = mt.startsWith("image/");
  if (!isPdf && !isImage) {
    return {
      document_type: "unknown",
      confidence: 0,
      reasoning: "",
      key_identifiers: [],
      second_guess: null,
      extracted_year: null,
      extracted_amount_or_total: null,
      document_date: null,
      issuer_name: null,
      party_name: null,
      account_or_period: null,
      form_identifier: null,
      amounts: [],
      fields_confidence: 0,
      looks_correct: false,
      issue_if_any: "Unsupported file format for AI classification.",
      usability: USABLE_BY_DEFAULT,
    };
  }

  const provider = getProvider();
  if (provider === "openai" ? !isOpenAiConfigured() : !isAnthropicConfigured()) {
    console.warn(`[ai/classify] no API key for provider=${provider} — skipping`);
    return null;
  }

  // Downscale oversized images before the model (accuracy-neutral; cuts cost +
  // keeps large photos under the vision model's limits). PDFs pass through
  // untouched — both providers read PDFs natively.
  const prepared = isImage
    ? await normalizeImageForAi(opts.fileBytes, mt)
    : { bytes: opts.fileBytes, mimeType: mt };
  const base64 = prepared.bytes.toString("base64");
  const systemPrompt = buildSystemPrompt(opts.expectedDocType, opts.request);
  const requestedAs =
    opts.request?.requestLabel?.trim() ||
    opts.request?.requestLabelFr?.trim() ||
    opts.expectedDocType;
  const userText = `The accountant requested: "${requestedAs}". Classify this document and judge whether it can satisfy that request.`;

  // Both providers return the same raw object shape; parseClassification (with
  // all its tolerant defaults) is the single source of truth for turning it
  // into a ClassificationResult.
  let raw: Record<string, unknown> | null = null;

  if (provider === "openai") {
    const model = getOpenAiModel();
    const { raw: r, usage } = await classifyWithOpenAI({
      model,
      systemPrompt,
      userText,
      schema: CLASSIFY_TOOL.input_schema,
      isPdf,
      base64,
      mediaType: prepared.mimeType,
    });
    raw = r;
    console.info(
      `[ai/classify] provider=openai model=${model} in_tokens=${usage?.input ?? "?"} out_tokens=${usage?.output ?? "?"}${usage?.reasoning != null ? ` reasoning_tokens=${usage.reasoning}` : ""}`,
    );
  } else {
    const c = client();
    if (!c) return null;

    type ContentBlock =
      | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      | { type: "text"; text: string };

    const content: ContentBlock[] = isPdf
      ? [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          { type: "text", text: userText },
        ]
      : [
          {
            type: "image",
            source: { type: "base64", media_type: prepared.mimeType, data: base64 },
          },
          { type: "text", text: userText },
        ];

    const resp = await c.messages.create(
      {
        model: MODEL,
        max_tokens: 1200,
        system: systemPrompt,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: "tool", name: "classify_document" },
        // sdk types are strict but the SDK accepts this content shape at runtime
        messages: [{ role: "user", content: content as never }],
      },
      // Bound each call so one slow or hung read can't eat the whole worker
      // run (the SDK default timeout is 10 minutes). One retry absorbs a
      // transient blip; anything past that falls through to the durable
      // job-queue retry rather than blocking the batch.
      { timeout: 40_000, maxRetries: 1 },
    );

    // Cost/latency visibility — token counts per classification (Phase 7).
    console.info(
      `[ai/classify] provider=anthropic model=${MODEL} in_tokens=${resp.usage?.input_tokens ?? "?"} out_tokens=${resp.usage?.output_tokens ?? "?"}`,
    );

    for (const block of resp.content) {
      if (block.type === "tool_use" && block.name === "classify_document") {
        raw = block.input as Record<string, unknown>;
        break;
      }
    }
  }

  if (!raw) return null;
  return parseClassification(raw);
}

export function parseClassification(
  raw: Record<string, unknown>,
): ClassificationResult | null {
  const doc = raw.document_type;
  const conf = raw.confidence;
  if (typeof doc !== "string") return null;
  if (typeof conf !== "number") return null;

  // Hard identity rule (see withUnreadableOwner): a document is unusable when its
  // owner can't be identified — either the model flagged it (owner_identifiable
  // false) OR no owner/company name was legible at all (party_name empty). The
  // two model signals sometimes disagree (it can claim "identifiable" while
  // leaving the name blank), so a MISSING name is treated as ground truth: if
  // there is no name to confirm the document by, it cannot be accepted.
  const partyName = str(raw.party_name);
  // Only enforced on responses that include the owner_identifiable signal (all
  // current model output does); a missing name then counts as "no owner". Older
  // responses without the field keep their prior behavior, so a usable verdict
  // is never silently flipped just because no party was extracted.
  const hasOwnerSignal = typeof raw.owner_identifiable === "boolean";
  const ownerUnreadable =
    hasOwnerSignal && (raw.owner_identifiable === false || partyName === null);

  // Hard key-values rule (see withObscuredKeyValues): a document whose DEFINING
  // numbers are blacked out / redacted / unreadable is unusable, however clean
  // the rest is. Like the owner rule, only enforced when the model returned the
  // signal — older responses keep prior behavior, so a usable verdict is never
  // silently flipped.
  const keyValuesObscured = raw.key_values_obscured === true;

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
    document_date: str(raw.document_date),
    issuer_name: str(raw.issuer_name),
    party_name: ownerUnreadable ? null : partyName,
    account_or_period: str(raw.account_or_period),
    form_identifier: str(raw.form_identifier),
    amounts: parseAmounts(raw.amounts),
    fields_confidence:
      typeof raw.fields_confidence === "number"
        ? Math.max(0, Math.min(1, raw.fields_confidence))
        : 0,
    looks_correct: raw.looks_correct === true,
    issue_if_any:
      typeof raw.issue_if_any === "string" && raw.issue_if_any.trim() !== ""
        ? raw.issue_if_any.trim()
        : null,
    // Both hard rules force the same shape (unusable + key_fields_obscured +
    // confidence floor); they differ only in the client message. Key-values
    // first so a void cheque with a blacked-out account number reads "your
    // numbers are hidden", not "we couldn't read the name".
    usability: keyValuesObscured
      ? withObscuredKeyValues(parseUsability(raw))
      : ownerUnreadable
        ? withUnreadableOwner(parseUsability(raw))
        : parseUsability(raw),
  };
}

// Trim to a non-empty string, or null. Keeps the extracted-field parsing terse.
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// Keep only well-formed { label, value } amount rows (the model can return
// partial entries), trim labels, and cap at 5 so a runaway list can't bloat
// the stored JSON.
function parseAmounts(v: unknown): { label: string; value: number }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is { label: string; value: number } =>
        !!x &&
        typeof x === "object" &&
        typeof (x as Record<string, unknown>).label === "string" &&
        typeof (x as Record<string, unknown>).value === "number",
    )
    .map((x) => ({ label: x.label.trim(), value: x.value }))
    .filter((x) => x.label !== "")
    .slice(0, 5);
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

// Force an "unusable — key fields obscured" verdict, surfaced ABOVE the auto-act
// threshold so it routes like any other firm-controlled auto-reject, adding the
// key_fields_obscured issue and a client-facing fallback message when the model
// didn't write one. Shared core of the two hard rules below (identity + key
// values), which differ only in their fallback wording. The prompt tells the
// model to flag these, but we ALSO enforce here so a redacted document can never
// slip through as "usable".
function forceFieldsObscured(
  v: UsabilityVerdict,
  fallbackEn: string,
  fallbackFr: string,
): UsabilityVerdict {
  const all_issues: UsabilityIssue[] = v.all_issues.includes(
    "key_fields_obscured",
  )
    ? v.all_issues
    : [...v.all_issues, "key_fields_obscured"];
  return {
    usable: false,
    confidence: Math.max(v.confidence, USABILITY_CONFIDENCE_THRESHOLD + 0.05),
    primary_issue: v.primary_issue ?? "key_fields_obscured",
    all_issues,
    issue_summary_en: v.issue_summary_en || fallbackEn,
    issue_summary_fr: v.issue_summary_fr || fallbackFr,
  };
}

// Hard rule #1: a document whose owner cannot be identified (name missing,
// covered, blacked out, or redacted) is never usable — Vylan can't confirm
// whose document it is.
function withUnreadableOwner(v: UsabilityVerdict): UsabilityVerdict {
  return forceFieldsObscured(
    v,
    "We couldn't read the name on this document, so we can't confirm whose it is. Please re-upload a copy with the name fully visible.",
    "Nous n'avons pas pu lire le nom sur ce document, donc nous ne pouvons pas confirmer à qui il appartient. Veuillez téléverser une copie où le nom est entièrement visible.",
  );
}

// Hard rule #2: a document whose DEFINING numbers are blacked out / redacted /
// unreadable (a void cheque's account number, a statement's balances, a slip's
// box amounts) is useless however clean the rest is.
function withObscuredKeyValues(v: UsabilityVerdict): UsabilityVerdict {
  return forceFieldsObscured(
    v,
    "Some of the key numbers on this document are blacked out or unreadable, so we can't use it. Please re-upload a copy with all the numbers fully visible.",
    "Certains chiffres importants de ce document sont masqués ou illisibles, donc nous ne pouvons pas l'utiliser. Veuillez téléverser une copie où tous les chiffres sont entièrement visibles.",
  );
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
