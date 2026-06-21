// QuickBooks Stage 3, Phase 1 — transaction-grade extraction.
//
// The tax-slip classifier in classify.ts is tuned to VERIFY a document (right
// type, right year, right person, legible). It deliberately does NOT capture
// the fields a bookkeeping ENTRY needs: which way the money flowed, the
// supplier/customer, the pre-tax subtotal, the tax split (GST/HST/QST/PST), the
// grand total, and the currency. Rather than overload that delicate prompt, this
// is a SEPARATE, focused read that runs ONLY for bookkeeping transaction
// documents (receipts + sales invoices) and ONLY when the firm has QuickBooks
// connected (so we never spend tokens on a firm that can't use the result).
//
// Output is stored alongside the classification (uploaded_files.ai_extracted_fields.transaction)
// and feeds the Phase-2 mapper, which turns it into a DRAFT QuickBooks suggestion.
// Nothing here writes to QuickBooks. Like classify.ts, every field is advisory —
// the accountant always has the final word.

import Anthropic from "@anthropic-ai/sdk";
import type { DocType } from "@/lib/db/templates";
import {
  isSupportedAiMime,
  normalizeImageForAi,
  normalizeMimeType,
  getProvider,
  getOpenAiModel,
} from "./classify";
import {
  classifyWithOpenAI,
  isOpenAiConfigured,
} from "./openai-classify";

const MODEL = "claude-sonnet-4-6";

// The ONLY document types Stage 3 turns into a transaction draft. Bank /
// credit-card statements are many transactions on one page (a much larger
// parsing job) and are intentionally out of scope for now. "bill" (a vendor
// invoice RECEIVED) is not a Vylan doc type today — an expense receipt covers
// the money-out case.
export const TRANSACTION_DOC_TYPES = new Set<DocType>(["receipt", "invoice"]);

// Run the transaction pass when EITHER the accountant asked for a receipt/invoice
// OR the AI read the upload as one. Either signal is enough — a receipt filed
// under a free-form ("other") checklist item should still be captured, and a
// document the AI recognises as a receipt is worth reading even if it was
// requested loosely.
export function shouldExtractTransaction(
  expectedDocType: string | null | undefined,
  detectedDocType: string | null | undefined,
): boolean {
  return (
    TRANSACTION_DOC_TYPES.has(expectedDocType as DocType) ||
    TRANSACTION_DOC_TYPES.has(detectedDocType as DocType)
  );
}

// A single tax line read off the document. `type` is the tax the model named
// (GST/HST/QST/PST/VAT or whatever the page says); the Phase-2 mapper matches it
// against the firm's cached QuickBooks tax codes — it is NOT a QuickBooks id.
export type TransactionTaxLine = {
  type: string;
  amount: number;
  rate: number | null; // percent, e.g. 5 for 5%, or null when not printed
};

export type TransactionExtraction = {
  // expense = money the client PAID OUT (a purchase receipt / bill);
  // income = money the client RECEIVED (a sales invoice they issued);
  // unknown when the page genuinely doesn't make the direction clear.
  direction: "expense" | "income" | "unknown";
  // The OTHER party, kept as two explicit fields so the mapper knows which
  // QuickBooks list to search: vendor_name for an expense (the supplier/merchant),
  // customer_name for income (the customer). null when not legible.
  vendor_name: string | null;
  customer_name: string | null;
  document_date: string | null; // ISO YYYY-MM-DD when possible, else as printed
  currency: string | null; // ISO 4217 (e.g. "CAD", "USD"); null when unstated
  subtotal: number | null; // pre-tax amount
  total: number | null; // grand total including tax
  taxes: TransactionTaxLine[]; // 0..n tax lines (empty when none legible)
  confidence: number; // 0..1, how sure the extraction is overall
  notes: string | null; // a short free-text caveat the accountant should see
};

let _client: Anthropic | null = null;
function client(): Anthropic | null {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

const TRANSACTION_TOOL = {
  name: "extract_transaction",
  description:
    "Extract the single bookkeeping transaction from a Canadian expense receipt or sales invoice.",
  input_schema: {
    type: "object" as const,
    properties: {
      direction: {
        type: "string",
        enum: ["expense", "income", "unknown"],
        description:
          "Which way the money flowed for the business whose books these are. 'expense' = the business PAID this (a purchase receipt, a supplier's bill). 'income' = the business RECEIVED this (a sales invoice it issued to a customer). 'unknown' only when the page genuinely doesn't make it clear.",
      },
      vendor_name: {
        type: ["string", "null"],
        description:
          "For an EXPENSE: the supplier / merchant / store the business paid (the name on the receipt's letterhead, e.g. 'Home Depot', 'Bell Canada'). Null for income, or when not legible.",
      },
      customer_name: {
        type: ["string", "null"],
        description:
          "For INCOME: the customer the business billed (the 'Bill to' / 'Sold to' party on a sales invoice). Null for an expense, or when not legible.",
      },
      document_date: {
        type: ["string", "null"],
        description:
          "The transaction date printed on the document (invoice date / purchase date) as an ISO date YYYY-MM-DD when you can, else as printed. Null if none is visible.",
      },
      currency: {
        type: ["string", "null"],
        description:
          "The ISO 4217 currency code of the amounts (e.g. 'CAD', 'USD'). Infer 'CAD' only when the document clearly indicates Canadian dollars (a Canadian address, GST/QST, '$' with CAD context); otherwise null rather than guessing.",
      },
      subtotal: {
        type: ["number", "null"],
        description:
          "The pre-tax subtotal (sum of line items before taxes). Null if not shown.",
      },
      total: {
        type: ["number", "null"],
        description:
          "The grand total actually charged, including all taxes. This is the headline amount of the transaction. Null if not legible.",
      },
      taxes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description:
                "The tax as named on the document: 'GST', 'HST', 'QST', 'PST', 'VAT', or the exact label printed (e.g. 'TPS', 'TVQ'). Do not invent a tax that isn't on the page.",
            },
            amount: {
              type: "number",
              description: "The dollar amount of this tax line.",
            },
            rate: {
              type: ["number", "null"],
              description:
                "The tax rate as a percentage if printed (e.g. 5 for 5%, 9.975 for QST), else null.",
            },
          },
          required: ["type", "amount", "rate"],
        },
        description:
          "Each tax line shown on the document. Empty array when no tax is itemized.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Your overall confidence (0-1) in this extraction. Lower it when amounts were hard to read, the direction was ambiguous, or the document is not really a receipt/invoice.",
      },
      notes: {
        type: ["string", "null"],
        description:
          "One short caveat the accountant should know (e.g. 'total partly cut off', 'multiple receipts in one photo', 'foreign currency'). Null when nothing stands out.",
      },
    },
    required: [
      "direction",
      "vendor_name",
      "customer_name",
      "document_date",
      "currency",
      "subtotal",
      "total",
      "taxes",
      "confidence",
      "notes",
    ],
  },
};

export function buildTransactionSystemPrompt(): string {
  return `You are a bookkeeping assistant for a small Canadian accounting firm.

You will be shown ONE expense receipt or ONE sales invoice that a client
uploaded. Extract the single transaction on it so it can later be drafted into
QuickBooks. Read the values straight off the page and NULL anything you cannot
read clearly. Never guess a number, a name, or a date.

Decide the DIRECTION from the business's point of view:
- expense: the business PAID this — a store/restaurant/supplier receipt, a
  utility or telecom bill, a purchase invoice addressed TO the business.
- income: the business RECEIVED this — a sales invoice the business ISSUED to
  its own customer.
- unknown: only when the page genuinely doesn't make the direction clear.

Then capture:
- vendor_name — the supplier/merchant for an expense (null for income).
- customer_name — the customer billed for income (null for an expense).
- document_date — the transaction date (ISO YYYY-MM-DD when possible).
- currency — the ISO code (e.g. CAD, USD). Only say CAD when the document
  clearly shows Canadian dollars; otherwise null.
- subtotal — the pre-tax amount.
- total — the grand total actually charged, including tax (the headline amount).
- taxes — one line per tax printed (GST/TPS, HST, QST/TVQ, PST), with the
  amount and, when printed, the rate. Quebec receipts often show GST/TPS at 5%
  AND QST/TVQ at 9.975%; capture BOTH as separate lines. Empty array when no tax
  is itemized.
- confidence — your honest overall confidence; lower it when amounts were hard
  to read or the direction was ambiguous.
- notes — one short caveat if something is off (cut off, multiple receipts in
  one photo, foreign currency), else null.

Sanity-check that subtotal + the tax amounts is close to the total; if they
clearly don't reconcile, lower your confidence and say so in notes. Do not
fabricate a subtotal or tax just to make them add up.

Always call the extract_transaction tool. Never reply with prose.`;
}

// Run the focused transaction read. Mirrors classifyDocument's provider switch
// and image handling. Returns null on an unsupported file, a missing API key, or
// any model/parse failure — the caller treats a null as "no transaction data"
// and never blocks the core classification on it.
export async function extractTransaction(opts: {
  fileBytes: Buffer;
  mimeType: string;
}): Promise<TransactionExtraction | null> {
  const mt = normalizeMimeType(opts.mimeType);
  if (!isSupportedAiMime(mt)) return null;
  const isPdf = mt === "application/pdf";

  const provider = getProvider();
  if (provider === "openai" ? !isOpenAiConfigured() : !process.env.ANTHROPIC_API_KEY?.trim()) {
    return null;
  }

  const prepared = isPdf
    ? { bytes: opts.fileBytes, mimeType: mt }
    : await normalizeImageForAi(opts.fileBytes, mt);
  const base64 = prepared.bytes.toString("base64");
  const systemPrompt = buildTransactionSystemPrompt();
  const userText =
    "Extract the single transaction (receipt or sales invoice) shown here.";

  let raw: Record<string, unknown> | null = null;

  if (provider === "openai") {
    const model = getOpenAiModel();
    const { raw: r, usage } = await classifyWithOpenAI({
      model,
      systemPrompt,
      userText,
      schema: TRANSACTION_TOOL.input_schema,
      isPdf,
      base64,
      mediaType: prepared.mimeType,
    });
    raw = r;
    console.info(
      `[ai/transaction] provider=openai model=${model} in_tokens=${usage?.input ?? "?"} out_tokens=${usage?.output ?? "?"}`,
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
        max_tokens: 1000,
        system: systemPrompt,
        tools: [TRANSACTION_TOOL],
        tool_choice: { type: "tool", name: "extract_transaction" },
        messages: [{ role: "user", content: content as never }],
      },
      { timeout: 40_000, maxRetries: 1 },
    );
    console.info(
      `[ai/transaction] provider=anthropic model=${MODEL} in_tokens=${resp.usage?.input_tokens ?? "?"} out_tokens=${resp.usage?.output_tokens ?? "?"}`,
    );
    for (const block of resp.content) {
      if (block.type === "tool_use" && block.name === "extract_transaction") {
        raw = block.input as Record<string, unknown>;
        break;
      }
    }
  }

  if (!raw) return null;
  return parseTransaction(raw);
}

// Tolerant parser — turns either provider's raw object into a clean
// TransactionExtraction, clamping and dropping anything malformed. Pure, so it
// is the single unit-tested source of truth (the providers are mocked away).
export function parseTransaction(
  raw: Record<string, unknown>,
): TransactionExtraction | null {
  if (!raw || typeof raw !== "object") return null;

  const direction =
    raw.direction === "expense" || raw.direction === "income"
      ? raw.direction
      : "unknown";

  return {
    direction,
    vendor_name: str(raw.vendor_name),
    customer_name: str(raw.customer_name),
    document_date: str(raw.document_date),
    currency: normalizeCurrency(raw.currency),
    subtotal: num(raw.subtotal),
    total: num(raw.total),
    taxes: parseTaxes(raw.taxes),
    confidence:
      typeof raw.confidence === "number"
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0,
    notes: str(raw.notes),
  };
}

// Trim to a non-empty string, or null.
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// A finite number, or null. Guards against NaN / Infinity the model may emit.
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Uppercase a 3-letter ISO currency code; anything else (a symbol, a word, a
// junk value) becomes null so the mapper isn't fed "$" as a currency.
function normalizeCurrency(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

// Keep only well-formed tax lines: a non-empty type label and a finite amount.
// rate is optional. Cap at 6 so a runaway list can't bloat the stored JSON.
function parseTaxes(v: unknown): TransactionTaxLine[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const type = str(o.type);
      const amount = num(o.amount);
      if (type === null || amount === null) return null;
      return { type, amount, rate: num(o.rate) };
    })
    .filter((x): x is TransactionTaxLine => x !== null)
    .slice(0, 6);
}
