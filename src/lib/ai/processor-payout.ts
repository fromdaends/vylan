// Payment-processor payout extraction — TRANSCRIPTION ONLY.
//
// A Stripe / Square / PayPal / Shopify payout statement is the missing piece
// in a bank feed: the feed shows ONE deposit, while the books need that
// deposit split into gross sales, refunds, processing fees and the tax on
// those fees. No bank feed can do that split, so a bookkeeper does it by hand
// every month for every processor. This read is the first half of removing
// that chore.
//
// Deliberately a SEPARATE pass from both the tax-slip classifier (tuned to
// verify identity + legibility) and the transaction extractor (tuned for a
// single receipt). Like them, it is fully best-effort: any failure leaves the
// payout null and the core classification is untouched.
//
// The model TRANSCRIBES printed figures and nothing else. Every verdict —
// does the split reconcile, is the payout negative — is computed in code by
// payout-reconcile.ts. The model is never asked whether the statement is
// "correct"; it is asked what the page says.

import Anthropic from "@anthropic-ai/sdk";
import type { DocType } from "@/lib/db/templates";
import {
  isSupportedAiMime,
  normalizeImageForAi,
  normalizeMimeType,
  getProvider,
  getOpenAiModel,
} from "./classify";
import { classifyWithOpenAI, isOpenAiConfigured } from "./openai-classify";
import type { PayoutFigures } from "./payout-reconcile";

const MODEL = "claude-sonnet-4-6";

/** The one doc type this pass reads. */
export const PAYOUT_DOC_TYPE: DocType = "processor_statement";

export function shouldExtractPayout(
  expectedDocType: string | null | undefined,
  detectedDocType: string | null | undefined,
): boolean {
  // Either signal is enough: an accountant who asked for a processor statement,
  // or a document the classifier recognised as one (a Stripe payout uploaded
  // against a free-form "other" checklist line still deserves the read).
  return (
    expectedDocType === PAYOUT_DOC_TYPE || detectedDocType === PAYOUT_DOC_TYPE
  );
}

export type PayoutExtraction = PayoutFigures & {
  /** "Stripe", "Square", "PayPal"… as printed. Null when not identifiable. */
  processor: string | null;
  /** Payout period, ISO YYYY-MM-DD, when the statement prints one. */
  periodStart: string | null;
  periodEnd: string | null;
  /** The date the money was deposited, when printed separately. */
  payoutDate: string | null;
  currency: string | null;
  /** The model's confidence in the TRANSCRIPTION (not in the arithmetic). */
  confidence: number;
  /** Short note when figures were hard to read, or "" when clean. */
  note: string;
};

const PAYOUT_TOOL = {
  name: "extract_payout",
  description:
    "Transcribe the figures printed on a payment-processor payout/settlement statement.",
  input_schema: {
    type: "object" as const,
    properties: {
      processor: {
        type: ["string", "null"],
        description:
          "The payment processor's name exactly as printed (Stripe, Square, PayPal, Shopify Payments, Moneris…). Null if not identifiable.",
      },
      period_start: {
        type: ["string", "null"],
        description:
          "First day of the payout period, ISO YYYY-MM-DD. Null when the statement doesn't print a period.",
      },
      period_end: {
        type: ["string", "null"],
        description: "Last day of the payout period, ISO YYYY-MM-DD, or null.",
      },
      payout_date: {
        type: ["string", "null"],
        description:
          "The date the net amount was paid out / deposited, ISO YYYY-MM-DD, or null.",
      },
      currency: {
        type: ["string", "null"],
        description: "ISO currency code of the figures (CAD, USD…), or null.",
      },
      gross_sales: {
        type: ["number", "null"],
        description:
          "Total GROSS sales/charges for the period BEFORE any deduction, as a positive number. This is the 'gross volume', 'total sales' or 'charges' line. Null when not clearly printed — never derive it by adding the other lines up.",
      },
      refunds: {
        type: ["number", "null"],
        description:
          "Total refunds/returns for the period as a POSITIVE number (it is a deduction; the sign is handled downstream). 0 when the statement shows a refunds line of zero. Null when there is no refunds line at all or it isn't legible.",
      },
      fees: {
        type: ["number", "null"],
        description:
          "Total processing fees the processor charged, as a POSITIVE number, EXCLUDING any tax on those fees. 0 when explicitly zero, null when not legible.",
      },
      fee_tax: {
        type: ["number", "null"],
        description:
          "Tax charged ON the processing fees (GST/HST/QST on Stripe or Square fees), as a POSITIVE number, when the statement breaks it out separately. Null when the statement does not separate it — do NOT split the fee yourself.",
      },
      adjustments: {
        type: ["number", "null"],
        description:
          "Any OTHER deduction for the period as a POSITIVE number: chargebacks, disputes, reserves, holds, adjustments. Sum them when several are listed. Null when there are none or they aren't legible.",
      },
      net_payout: {
        type: ["number", "null"],
        description:
          "The NET amount actually paid out / deposited to the bank for this period, as printed. This is the number that will appear as one deposit in the bank feed. Negative when the statement shows a negative payout. Null when not clearly printed.",
      },
      confidence: {
        type: "number",
        description:
          "0-1 confidence in the TRANSCRIPTION itself. Lower it when figures were faint, cut off, or the layout was ambiguous. This is not a judgment about whether the statement is correct.",
      },
      note: {
        type: "string",
        description:
          "One short plain-English note when a figure was hard to read or a line was ambiguous. Empty string when the read was clean. Never mention AI.",
      },
    },
    required: [
      "processor",
      "period_start",
      "period_end",
      "payout_date",
      "currency",
      "gross_sales",
      "refunds",
      "fees",
      "fee_tax",
      "adjustments",
      "net_payout",
      "confidence",
      "note",
    ],
    additionalProperties: false,
  },
};

export function buildPayoutSystemPrompt(): string {
  return `You transcribe payment-processor payout statements for an accounting firm. Your ONLY job is to report the figures the page prints. You never judge whether the statement is correct, and you never compute a missing number.

WHAT THIS DOCUMENT IS
A payout (settlement) statement from a payment processor such as Stripe, Square, PayPal, Shopify Payments, Moneris, Clover or Helcim. It summarises a period: everything the business sold, what was refunded, what the processor kept in fees, and the NET amount actually deposited to the bank.

THE FIGURES
Report each as a POSITIVE number in the statement's own currency, except net_payout which keeps its printed sign:
- gross_sales — the gross volume / total charges BEFORE deductions.
- refunds — refunds and returns.
- fees — the processor's fees, EXCLUDING tax on those fees.
- fee_tax — tax charged ON the fees (GST/HST/QST), ONLY when the statement breaks it out as its own line.
- adjustments — chargebacks, disputes, reserves, holds, other deductions, summed.
- net_payout — the amount actually deposited.

THE RULES THAT MATTER
1. NEVER CALCULATE. If the gross line is not printed, return null — do not add the other lines together to produce it. If the fee tax is not separated, return null — do not split the fee yourself. A null is useful; an invented number is dangerous, because a bookkeeper will book it.
2. DISTINGUISH ZERO FROM UNREADABLE. A printed "Refunds  0.00" is 0. A refunds line you cannot read, or that isn't there at all, is null.
3. IGNORE RUNNING BALANCES. This is not a bank statement. If the document is actually a bank or credit-card statement (many unrelated transactions with a running balance), set every figure to null and say so in note.
4. ONE PERIOD ONLY. If the document covers several payouts, transcribe the TOTALS row for the whole period when one is printed; when there is no total row, return nulls and explain in note. Never mix figures from different periods.
5. CURRENCY. Report the currency the figures are in. If the statement shows several currencies, transcribe only the primary/settlement currency and note it.

Always call the extract_payout tool. Never reply with prose.`;
}

let _anthropic: Anthropic | null = null;
function client(): Anthropic | null {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

/**
 * Run the payout read. Mirrors extractTransaction's provider switch and image
 * handling. Null on an unsupported file, missing key, or any model/parse
 * failure — the caller treats null as "no payout data" and never blocks the
 * core classification on it.
 */
export async function extractPayout(opts: {
  fileBytes: Buffer;
  mimeType: string;
}): Promise<PayoutExtraction | null> {
  const mt = normalizeMimeType(opts.mimeType);
  if (!isSupportedAiMime(mt)) return null;
  const isPdf = mt === "application/pdf";

  const provider = getProvider();
  if (
    provider === "openai"
      ? !isOpenAiConfigured()
      : !process.env.ANTHROPIC_API_KEY?.trim()
  ) {
    return null;
  }

  const prepared = isPdf
    ? { bytes: opts.fileBytes, mimeType: mt }
    : await normalizeImageForAi(opts.fileBytes, mt);
  const base64 = prepared.bytes.toString("base64");
  const systemPrompt = buildPayoutSystemPrompt();
  const userText =
    "Transcribe the payout figures shown on this processor statement.";

  let raw: Record<string, unknown> | null = null;

  if (provider === "openai") {
    const model = getOpenAiModel();
    const { raw: r, usage } = await classifyWithOpenAI({
      model,
      systemPrompt,
      userText,
      schema: PAYOUT_TOOL.input_schema,
      isPdf,
      base64,
      mediaType: prepared.mimeType,
    });
    raw = r;
    console.info(
      `[ai/payout] provider=openai model=${model} in_tokens=${usage?.input ?? "?"} out_tokens=${usage?.output ?? "?"}`,
    );
  } else {
    const c = client();
    if (!c) return null;

    type ContentBlock =
      | {
          type: "document";
          source: {
            type: "base64";
            media_type: "application/pdf";
            data: string;
          };
        }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
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
          { type: "text", text: userText },
        ]
      : [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: prepared.mimeType,
              data: base64,
            },
          },
          { type: "text", text: userText },
        ];

    const resp = await c.messages.create(
      {
        model: MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        tools: [PAYOUT_TOOL],
        tool_choice: { type: "tool", name: "extract_payout" },
        messages: [{ role: "user", content: content as never }],
      },
      { timeout: 40_000, maxRetries: 1 },
    );
    console.info(
      `[ai/payout] provider=anthropic model=${MODEL} in_tokens=${resp.usage?.input_tokens ?? "?"} out_tokens=${resp.usage?.output_tokens ?? "?"}`,
    );
    for (const block of resp.content) {
      if (block.type === "tool_use" && block.name === "extract_payout") {
        raw = block.input as Record<string, unknown>;
        break;
      }
    }
  }

  if (!raw) return null;
  return parsePayout(raw);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
// A deduction line the model was told to report positive. Guard against a
// model that helpfully returns it negative anyway: the sign is ours to apply.
function positive(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.abs(n);
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(v: unknown): string | null {
  const s = str(v);
  return s && ISO_DATE.test(s) ? s : null;
}

/**
 * Tolerant parser — turns either provider's raw object into a clean
 * PayoutExtraction, dropping anything malformed. Pure, so it is the
 * unit-tested source of truth with the providers mocked away.
 */
export function parsePayout(raw: Record<string, unknown>): PayoutExtraction {
  const confidence = num(raw.confidence);
  return {
    processor: str(raw.processor),
    periodStart: isoDate(raw.period_start),
    periodEnd: isoDate(raw.period_end),
    payoutDate: isoDate(raw.payout_date),
    currency: str(raw.currency)?.toUpperCase().slice(0, 3) ?? null,
    grossSales: positive(raw.gross_sales),
    refunds: positive(raw.refunds),
    fees: positive(raw.fees),
    feeTax: positive(raw.fee_tax),
    adjustments: positive(raw.adjustments),
    // The ONLY figure that keeps its printed sign — a negative payout is real.
    netPayout: num(raw.net_payout),
    confidence:
      confidence == null ? 0 : Math.min(1, Math.max(0, confidence)),
    note: str(raw.note) ?? "",
  };
}
