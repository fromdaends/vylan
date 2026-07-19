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
import {
  classifyWithOpenAI,
  classifyTextWithOpenAI,
  isOpenAiConfigured,
} from "./openai-classify";

const MODEL = "claude-sonnet-4-6";

// Which AI runs the classifier. Defaults to Anthropic (Claude); set
// AI_CLASSIFIER_PROVIDER=openai to use GPT-5 Mini instead. Read per-call so the
// provider can be flipped (and reverted) via env with no code change.
// Exported so the set-assessment worker rides the SAME provider switch.
export function getProvider(): "anthropic" | "openai" {
  return process.env.AI_CLASSIFIER_PROVIDER?.toLowerCase() === "openai"
    ? "openai"
    : "anthropic";
}

// The OpenAI model id, overridable via env. Default is gpt-5.4 (full): it's the
// cheapest GPT-5 revision whose vision reads images at full fidelity ("high"
// detail goes up to ~2.56M px / 2048px on the long edge). The older gpt-5-mini
// and base gpt-5 down-sample images to ~768px on the short edge before they
// "see" them, which hid subtle redactions (a scribble over a void cheque's
// transit digits sailed through as "looks good"). Override per-deployment with
// OPENAI_MODEL (e.g. "gpt-5.4-mini" cheaper, or "gpt-5.5" newer) with no code change.
export function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.4";
}

// Cap the long edge before the model sees it. 2048px matches the high-detail
// input ceiling of the current vision models (GPT-5.4+ "high" reads up to
// ~2.56M px / 2048px; Opus reads higher still), so we preserve the fine detail
// a classifier needs to catch a scribble over a cheque's transit digits, while
// still bounding the upload payload + token cost (a phone photo is often
// 3000-4000px on the long edge). The previous 1568px cap predated full-fidelity
// vision and threw that detail away, which is how partial redactions slipped by.
const MAX_IMAGE_EDGE = 2048;

// Downscale an oversized image (and honour EXIF rotation) before it goes to the
// model. Fail-soft: ANY error falls back to the original bytes so analysis
// never breaks on a quirky file. PDFs are never passed here. Exported so the
// set-assessment worker prepares its images identically.
export async function normalizeImageForAi(
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
    // Quality 90 (was 82): faint, low-contrast detail — embossed white-on-white
    // ID digits, a light scribble over a transit number — is exactly what JPEG
    // compression smears first. The few extra KB are worth keeping that detail
    // legible to the model.
    const out = await pipeline.jpeg({ quality: 90 }).toBuffer();
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
  // Whether the document plausibly belongs to the requested client, judged from
  // ALL the evidence on the page (a business name that may be the client's own
  // company, a spouse/dependant on a family doc, the issuer, account holders —
  // not just the personal name). null on older responses that predate this
  // field, so callers can fall back to the name-token heuristic.
  belongs_to_client: boolean | null;
  belongs_confidence: number;
  // The model's single honest "is this the correct + usable document for what
  // was requested" headline score (type + year + whose-document + legibility,
  // weighed together) — what the accountant sees, not the raw type confidence.
  overall_confidence: number;
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
          "Is ANY of the document's DEFINING numbers/values blacked out, scribbled over, penned through, taped/whited out, redacted, smudged, covered, cut off, or otherwise unreadable — e.g. the bank ACCOUNT / transit / institution number on a void cheque or direct-deposit form, the account number or balances on a statement, the box amounts on a tax slip, the figures on an assessment? PARTIAL obscuring counts: if even a single digit of a key number is covered by a mark, return true — do not guess the hidden digit and call it readable. Return true even if the rest of the page is perfectly clear and even if the client redacted it deliberately. Do NOT return true for expected printed elements (a VOID stamp, a logo, a signature, a watermark) or incidental marks that don't sit on top of a value. A document whose defining numbers are obscured must be treated as unusable.",
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
      belongs_to_client: {
        type: "boolean",
        description:
          "Weighing ALL the evidence on the page — NOT just the name — does this document plausibly belong to the requested client? A company/business name (which may well be the client's OWN business), a spouse or dependant on a family document, the issuer/payer, account holders, or a different address can all legitimately differ from the client's personal name. Return FALSE only when the evidence clearly shows the document is about an UNRELATED individual (e.g. a personal slip in a different person's name with nothing on the page tying it to the client). When genuinely unsure, return TRUE and put the doubt in issue_if_any — never bounce an innocent client on a hunch.",
      },
      belongs_confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How confident you are in belongs_to_client. Use >=0.85 only when the evidence is clear; lower while you are piecing it together. Vylan only auto-sends-back a wrong-owner document at >=0.80.",
      },
      overall_confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Your SINGLE honest overall score (0-1) that this is the CORRECT and USABLE document for what the accountant requested — weighing the document type, the tax year, whether it belongs to this client, AND legibility together. This is the headline number the accountant sees, so it must reflect your true assessment: a clean, right document scores high; a perfectly legible document that is the WRONG type, the WRONG year, or about a clearly DIFFERENT person scores LOW even when you are certain what it is. Do NOT just echo document_type confidence.",
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
      "belongs_to_client",
      "belongs_confidence",
      "overall_confidence",
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
  const clientName = ctx.clientName?.trim() || null;
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

- text_unreadable: blur, motion blur, smearing, low resolution, pixelation, or
  faint/fading ink makes text illegible. Flag this in EITHER of these cases:
  (a) one critical value (an amount, account/transit number, name, or date) is
  too soft, small, or fuzzy to read every character with confidence; OR
  (b) a MEANINGFUL PORTION of the document's actual content is illegible — for
  example several rows of a statement's or ledger's transactions, a block of
  line items, or a paragraph of text that is smeared or out of focus — EVEN IF
  the letterhead, the document's identity, and a few totals are perfectly clear.
  An accountant must be able to read the document's SUBSTANCE, not merely
  identify it: a bank-statement page whose transaction lines cannot be read is
  unusable no matter how crisp the header and the balance column are. Do NOT
  excuse a smeared block because you can still tell what the document is or can
  read some of its numbers.
- key_fields_obscured: important fields (amounts, names, dates, account
  numbers) are covered, scratched out, redacted, blacked out, or missing.
  This ALWAYS includes the case where the NAME of the person or business the
  document is about (employee, recipient, taxpayer, account holder) is covered,
  redacted, scribbled over, or unreadable — Vylan cannot accept a document when
  it cannot confirm whose it is.
  Flag a DELIBERATE REDACTION here EVEN WHEN every visible amount still
  reconciles: a solid black bar or box, a whited-out patch, or a heavy marker
  scribble placed OVER content so that a number, a name, a date, an
  account/reference number, or a line of text is hidden. A client hiding part of
  a financial document is exactly what the accountant must review, so flag it
  and describe what looks covered — never wave it through just because the totals
  you CAN see add up, or because you did not personally need the hidden value.
  But do NOT mistake the document's OWN printed design for a redaction: the
  bank/issuer logo, a coloured or dark HEADER BANNER carrying a product name (for
  example the black "Day-to-Day Banking" banner across the top of a Scotiabank
  statement), routine page furniture, and a printed VOID stamp are EXPECTED
  elements. The test: a redaction HIDES content that should be there; a banner or
  logo IS content that belongs there. When unsure whether a black area covers a
  real value or is just the header design, look for a value/label that is now
  missing where one is clearly expected — only then flag it.
- partial_capture: the document's SUBSTANTIVE content is sliced off at the edge
  of the photo. Flag this whenever a real value or a line of content runs off the
  frame — an amount, an account/transit/reference number, a name, a date, a
  balance, a sliced column or row of a statement/ledger, or a block of line items
  truncated at an edge. The accountant needs the document's full SUBSTANCE in
  frame, so a crop that eats into the transactions, the totals, the
  account/holder details, or any figure is unusable — ask for a retake.
  But do NOT flag a crop that only loses NON-substantive edges. A cut-off
  DECORATIVE TOP is fine as long as the real content is all there: the
  bank/issuer logo, a coloured or dark HEADER BANNER carrying a product name (for
  example the black "Day-to-Day Banking" banner across the top of a Scotiabank
  statement), marketing/promotional blurbs, other marginal page furniture, a
  clean blank-paper margin, and the small page-number footer line (e.g.
  "page 2 of 4") may all be clipped WITHOUT penalty. The test: is any actual
  VALUE, field, or line of the document's content truncated? If yes, flag it. If
  the only thing off the edge is a logo, a banner, or a marketing margin and
  every figure and detail is fully visible, leave it USABLE — do NOT reject a
  statement just because its letterhead is cropped. This is about this single
  photo, NOT about whether other pages exist.
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
- missing_pages: do NOT flag this for a single photo that is simply one page of
  a larger document. Clients routinely upload a multi-page document (a bank
  statement, a lease) as SEVERAL separate photos, and whether the whole set
  arrived is judged separately across ALL of the item's files — never on this one
  file alone. A standalone continuation page, an inside page, or a page marked
  "page 1 of 4" must stay USABLE here. Completeness of the set is decided
  elsewhere, so leaving pages out is not a reason to reject this individual photo.
- screenshot_of_screen: this is a PHOTO of a monitor or phone screen (visible
  bezel, glare, or moiré) rather than the document itself, and that impairs
  reading. A clean digital screenshot of the actual document is USABLE.
- other: a usability issue that doesn't match the categories above

If the document is borderline (a FEW characters slightly soft but still
confidently readable in full), prefer USABLE. Only mark UNUSABLE if a human
accountant would clearly reject it. But be honest about what "borderline" means:
a whole block of a statement's transaction lines smeared out of focus is NOT
borderline — a human accountant would send that back even if the header and one
or two totals are crisp. "I can read some of it" is not "it is readable."

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
of Assessment its figures; a government photo ID, health-insurance card (e.g. a
Quebec RAMQ "assurance maladie" card), SIN card, driver's licence, or passport
its ID/card NUMBER and its DATE OF BIRTH.

Inspect EVERY key number character by character. Set key_values_obscured to
true whenever ANY of those defining numbers is blacked out, scribbled over,
penned through, taped or whited out, redacted, smudged, covered by a sticker or
finger, cut off, or otherwise unreadable — EVEN IF everything else is perfectly
legible, and EVEN IF the client clearly redacted it on purpose to "protect"
their information. CRITICAL: this includes PARTIAL obscuring — if even a SINGLE
digit or character of a key number is covered by a mark, scribble, or smudge,
that whole number counts as obscured. Do NOT infer, guess, or reconstruct a
hidden digit from context and then call the number readable — a partially
struck-through transit number (e.g. a black mark over the leading digits with
only the last few showing) is OBSCURED, full stop.

Treat the smallest print as the most important pixels on the page — examine the
key numbers at the highest scrutiny you can and never skim them. The mark that
hides a value is often subtle, so look specifically for ALL of these sitting on
or across a defining number: a faint or localized blur on just that value, a
scratch-off or scraped/abraded patch, a smudge or ink-bleed, thinning or fading
ink, correction fluid or correction tape (white-out), a stray pen stroke or
highlighter, pixelation concentrated on the value, or a fold, crease, staple, or
tear that crosses a digit. If you cannot read every character of a key value
with FULL confidence because of any of these, do not guess the value — treat it
as obscured (key_values_obscured), or unreadable (text_unreadable) when the
whole value is too soft or small to make out.

A PARTIAL read is NOT a successful read. If you can make out only SOME of the
characters of a key number or date — say the first group of an ID number but not
the rest, or a couple of digits of a date — you must NOT write that partial
string into any field (party_name, account_or_period, amounts, document_date,
…) as if it were the whole value, and you must NOT call the document usable. Set
key_values_obscured=true instead. Photographed identity cards are the classic
trap: a RAMQ / health card or driver's licence whose raised, embossed, or
laminated digits are too faint, glare-washed, droplet-spotted, or low-contrast
to read IN FULL is unusable — read the card NUMBER and the DATE OF BIRTH
character by character, and if any character is uncertain, treat it as obscured
rather than reporting a shortened or approximated number.

When key_values_obscured is true you MUST also set usable=false,
primary_issue=key_fields_obscured, and a usability_confidence of at least 0.85.
A void cheque with any struck-out digit in its account, transit, or institution
number is useless and must be sent back.

Guardrail so you don't over-reject: EXPECTED printed elements are NOT redactions
— a "VOID" stamp or watermark across a cheque, the bank's logo, a signature, a
faint security pattern, or shading that does not sit ON TOP OF a value are all
normal. Only count a mark as obscuring when it actually covers part of a value
the document is meant to show.

For financial statements (trial balance, income statement, balance sheet,
general ledger), the owner is the COMPANY named in the header — read it into
party_name. Whenever you CAN identify the real owner, ALWAYS copy that exact
name into party_name; never leave party_name blank if a real name is legible.
Obvious placeholder / sample / template names (e.g. "Sample Company",
"Example", "John Doe", "Test", a generic "You") do NOT identify a real owner —
treat them as missing: set party_name to null and owner_identifiable to false.

WHOSE DOCUMENT IS THIS — set belongs_to_client by piecing together ALL the
evidence on the page, not just the name${clientName ? ` (the client is ${clientName})` : ""}.
A business or company name is NOT automatically a stranger: a T2125, a GST/QST
return, or a financial statement headed "Smith Plumbing Inc." for an individual
client is very likely that client's OWN business — set belongs_to_client = true.
A spouse or dependant on a family document, the issuer/payer, an account holder,
or a different mailing address can also legitimately differ from the client's
personal name. Set belongs_to_client = FALSE only when the evidence clearly
points to an UNRELATED individual — e.g. a personal T4 in a different person's
name with nothing on the page connecting it to the client. When you ARE
confident it belongs to someone else (belongs_confidence >= 0.85), also set
usable=false with wrong_document_type and write issue_summary asking for the
client's own document. When you are merely unsure, keep belongs_to_client = true
with a lower belongs_confidence and note the doubt in issue_if_any — the
accountant reviews it. Never send an innocent client's correct document back
over a name you simply did not recognise.

OVERALL SCORE — set overall_confidence (0-1) to your single honest judgment that
this is the CORRECT, USABLE document for what was requested, weighing type + tax
year + whose-document-it-is + legibility TOGETHER. A clean exact match scores
high; a document that is the wrong type, the wrong year, about a clearly
different person, or unusable scores LOW even when you are certain what it is.
This is the headline number the accountant sees — make it mean something, do not
just copy document_type confidence.

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
      belongs_to_client: null,
      belongs_confidence: 0,
      overall_confidence: 0,
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

// Classify a MACHINE-READABLE document from its extracted TEXT instead of an
// image. The vision model can't open an Excel workbook or a CSV, so for those we
// read the text in code (see readable-extract.ts) and hand it here — the model
// still performs the SAME checklist verification (is this the right document
// type for the request? does it belong to the client?), just from text. Also
// usable, and cheaper, for text-layer PDFs. Because code already read it, the
// document is legible by definition, so the prompt steers the model away from
// image-quality judgments and toward TYPE + request-match.
export async function classifyDocumentFromText(opts: {
  expectedDocType: DocType;
  text: string;
  // A human word for the source, woven into the prompt ("spreadsheet", "CSV",
  // "PDF") so the model knows it's reading extracted text, not prose.
  sourceLabel: string;
  request?: RequestContext;
}): Promise<ClassificationResult | null> {
  const text = opts.text.trim();
  if (text === "") return null;

  const provider = getProvider();
  if (provider === "openai" ? !isOpenAiConfigured() : !isAnthropicConfigured()) {
    console.warn(`[ai/classify] no API key for provider=${provider} — skipping`);
    return null;
  }

  const systemPrompt = buildSystemPrompt(opts.expectedDocType, opts.request);
  const requestedAs =
    opts.request?.requestLabel?.trim() ||
    opts.request?.requestLabelFr?.trim() ||
    opts.expectedDocType;
  const userText =
    `The accountant requested: "${requestedAs}". Below is the FULL machine-extracted ` +
    `text of an uploaded ${opts.sourceLabel}. It was read directly by software, so it ` +
    `is legible by definition — do NOT flag blur, glare, image quality, or a missing/` +
    `unreadable owner just because this is plain text. Judge the document TYPE and ` +
    `whether it can satisfy the request, and set "usable" to true unless the CONTENT ` +
    `itself shows this is not a real, usable document. Then classify it.\n\n` +
    `----- BEGIN DOCUMENT TEXT -----\n${opts.text}\n----- END DOCUMENT TEXT -----`;

  let raw: Record<string, unknown> | null = null;

  if (provider === "openai") {
    const model = getOpenAiModel();
    const { raw: r, usage } = await classifyTextWithOpenAI({
      model,
      systemPrompt,
      userText,
      schema: CLASSIFY_TOOL.input_schema,
    });
    raw = r;
    console.info(
      `[ai/classify] provider=openai model=${model} mode=text in_tokens=${usage?.input ?? "?"} out_tokens=${usage?.output ?? "?"}`,
    );
  } else {
    const c = client();
    if (!c) return null;
    const resp = await c.messages.create(
      {
        model: MODEL,
        max_tokens: 1200,
        system: systemPrompt,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: "tool", name: "classify_document" },
        messages: [{ role: "user", content: userText }],
      },
      { timeout: 40_000, maxRetries: 1 },
    );
    console.info(
      `[ai/classify] provider=anthropic model=${MODEL} mode=text in_tokens=${resp.usage?.input_tokens ?? "?"} out_tokens=${resp.usage?.output_tokens ?? "?"}`,
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

  // Holistic identity judgment (see withWrongRecipient + the prompt): the model
  // weighs ALL the evidence to decide whether the document belongs to the
  // requested client. Only a CONFIDENT "no" (>= the auto-act threshold)
  // hard-rejects, so a business name or a spouse the model is merely unsure
  // about never bounces an innocent client.
  const belongsToClient =
    typeof raw.belongs_to_client === "boolean" ? raw.belongs_to_client : null;
  const belongsConfidence =
    typeof raw.belongs_confidence === "number"
      ? Math.max(0, Math.min(1, raw.belongs_confidence))
      : 0;
  const wrongRecipient =
    belongsToClient === false &&
    belongsConfidence >= USABILITY_CONFIDENCE_THRESHOLD;

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
    belongs_to_client: belongsToClient,
    belongs_confidence: belongsConfidence,
    // Honest headline score. Older responses without it fall back to the
    // document_type confidence so the UI always has a number to show.
    overall_confidence:
      typeof raw.overall_confidence === "number"
        ? Math.max(0, Math.min(1, raw.overall_confidence))
        : Math.max(0, Math.min(1, conf)),
    // Hard rules force an unusable verdict the firm-controlled router then acts
    // on. Order = message precedence: obscured key numbers, then an unreadable
    // owner, then a confident wrong-OWNER (a clean scan of someone else's
    // document). They differ only in the client-facing message.
    usability: keyValuesObscured
      ? withObscuredKeyValues(parseUsability(raw))
      : ownerUnreadable
        ? withUnreadableOwner(parseUsability(raw))
        : wrongRecipient
          ? withWrongRecipient(parseUsability(raw))
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

// Hard rule #3: a document that confidently belongs to SOMEONE ELSE — a clean,
// readable scan of an unrelated person's slip — is the wrong document however
// legible. Unlike a blunt name-token check this fires on the model's HOLISTIC
// belongs_to_client judgment, so a business / spouse / dependant it reasoned
// through is NOT bounced. primary_issue is wrong_document_type (not
// key_fields_obscured), and the model's own bilingual reason is preferred over
// the generic fallback so the client sees a specific "we need YOUR document".
function withWrongRecipient(v: UsabilityVerdict): UsabilityVerdict {
  const all_issues: UsabilityIssue[] = v.all_issues.includes(
    "wrong_document_type",
  )
    ? v.all_issues
    : [...v.all_issues, "wrong_document_type"];
  return {
    usable: false,
    confidence: Math.max(v.confidence, USABILITY_CONFIDENCE_THRESHOLD + 0.05),
    primary_issue: v.primary_issue ?? "wrong_document_type",
    all_issues,
    issue_summary_en:
      v.issue_summary_en ||
      "This document appears to belong to someone else. Please upload the client's own document.",
    issue_summary_fr:
      v.issue_summary_fr ||
      "Ce document semble appartenir à une autre personne. Veuillez téléverser le document du client.",
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
