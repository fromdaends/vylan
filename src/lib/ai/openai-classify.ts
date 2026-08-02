// OpenAI (GPT-5 family) classifier path. Mirrors the Anthropic call in
// classify.ts but talks to OpenAI's Chat Completions API with Structured
// Outputs (json_schema, strict) so the model returns the SAME shape the
// Anthropic tool-call produced. classify.ts then runs BOTH providers' raw
// output through the one parseClassification(), so all the tolerant parsing +
// safety defaults are shared. Selected at runtime via AI_CLASSIFIER_PROVIDER.
import OpenAI from "openai";

let _client: OpenAI | null = null;
function client(): OpenAI | null {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === "") return null;
  // Hard 40s timeout (under the 60s serverless maxDuration) + no SDK retries:
  // the classifier runs inside the upload route's after() and the cron worker,
  // so a slow/hung call must fail cleanly within the function budget rather than
  // be killed mid-write (which left documents stuck on "Analyzing…" forever).
  // The 15-minute cron is the retry path, so SDK-level retries aren't needed.
  _client = new OpenAI({ apiKey: key, timeout: 40_000, maxRetries: 0 });
  return _client;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

// OpenAI Structured Outputs (strict) is stricter than Anthropic's tool schema:
// every object must set additionalProperties:false and list ALL its keys in
// `required`, and it rejects validation keywords like minimum/maximum. Derive a
// strict-safe copy of the shared schema here — values are still clamped in
// parseClassification, so dropping the numeric bounds changes nothing.
type Json = Record<string, unknown>;
export function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (node && typeof node === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(node as Json)) {
      if (k === "minimum" || k === "maximum") continue;
      out[k] = toStrictSchema(v);
    }
    const props = out.properties;
    if (props && typeof props === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(props as Json);
    }
    return out;
  }
  return node;
}

// Reasoning effort. Default "medium". "low" glanced and missed subtle reads
// that the SAME model (gpt-5.4) catches in the ChatGPT app, where it thinks
// harder before answering — e.g. a photographed health card whose faint
// embossed number it couldn't fully read, yet passed at 95%. Medium restores
// that scrutiny at a sane cost (~2x low's output tokens; the next step, "high",
// costs more per doc than Opus, so it's not the default). Bounded by the 40s
// client timeout above + the 15-minute cron retry, so a slow run degrades to a
// delayed verdict, not a stuck upload. Tune via OPENAI_REASONING_EFFORT.
const REASONING_EFFORT =
  (process.env.OPENAI_REASONING_EFFORT?.trim() as
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | undefined) || "medium";

export async function classifyWithOpenAI(opts: {
  model: string;
  systemPrompt: string;
  userText: string;
  schema: Record<string, unknown>;
  isPdf: boolean;
  base64: string;
  mediaType: string;
}): Promise<{
  raw: Record<string, unknown> | null;
  usage: { input: number; output: number; reasoning: number | null } | null;
}> {
  const c = client();
  if (!c) return { raw: null, usage: null };

  // GPT-5 reads PDFs natively (extracts text + page images); images go in as a
  // base64 data URL. Mirrors the Anthropic document/image split.
  const filePart = opts.isPdf
    ? {
        type: "file" as const,
        file: {
          filename: "document.pdf",
          file_data: `data:application/pdf;base64,${opts.base64}`,
        },
      }
    : {
        type: "image_url" as const,
        image_url: {
          url: `data:${opts.mediaType};base64,${opts.base64}`,
          // Force full-detail tiling. The default ("auto") can quietly
          // down-sample the image, which blinded the model to small redactions;
          // "high" makes GPT-5.4+ read it at full fidelity (up to ~2.56M px).
          detail: "high" as const,
        },
      };

  const resp = await c.chat.completions.create({
    model: opts.model,
    // Cap generously so reasoning + JSON output is never truncated; only tokens
    // actually used are billed.
    max_completion_tokens: 5000,
    reasoning_effort: REASONING_EFFORT,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "classify_document",
        strict: true,
        schema: toStrictSchema(opts.schema) as Record<string, unknown>,
      },
    },
    messages: [
      { role: "system", content: opts.systemPrompt },
      {
        role: "user",
        content: [filePart, { type: "text" as const, text: opts.userText }] as never,
      },
    ],
  });

  const u = resp.usage;
  const usage = u
    ? {
        input: u.prompt_tokens,
        output: u.completion_tokens,
        reasoning: u.completion_tokens_details?.reasoning_tokens ?? null,
      }
    : null;

  const msg = resp.choices?.[0]?.message;
  if (!msg || msg.refusal) return { raw: null, usage };
  const content = msg.content;
  if (typeof content !== "string" || content.trim() === "") {
    return { raw: null, usage };
  }
  try {
    return { raw: JSON.parse(content) as Record<string, unknown>, usage };
  } catch {
    return { raw: null, usage };
  }
}

// Multi-file sibling of classifyWithOpenAI for the SET assessment: one call,
// MANY files, judged together. Each file is preceded by a "File N:" text part
// so the model's image_index answers anchor unambiguously to upload order.
// Same client (40s timeout, no SDK retries — the job queue is the retry path),
// same Structured Outputs + toStrictSchema treatment, same PDF/image split per
// attachment as the single-file call.
export async function assessSetWithOpenAI(opts: {
  model: string;
  systemPrompt: string;
  userText: string;
  schemaName: string;
  schema: Record<string, unknown>;
  files: { isPdf: boolean; base64: string; mediaType: string }[];
}): Promise<{
  raw: Record<string, unknown> | null;
  usage: { input: number; output: number; reasoning: number | null } | null;
}> {
  const c = client();
  if (!c) return { raw: null, usage: null };

  type Part =
    | { type: "text"; text: string }
    | { type: "file"; file: { filename: string; file_data: string } }
    | { type: "image_url"; image_url: { url: string; detail: "high" } };
  const parts: Part[] = [];
  opts.files.forEach((f, i) => {
    parts.push({ type: "text", text: `File ${i + 1} of ${opts.files.length}:` });
    parts.push(
      f.isPdf
        ? {
            type: "file",
            file: {
              filename: `document-${i + 1}.pdf`,
              file_data: `data:application/pdf;base64,${f.base64}`,
            },
          }
        : {
            type: "image_url",
            image_url: {
              url: `data:${f.mediaType};base64,${f.base64}`,
              // Full-detail tiling, same rationale as the single-file call:
              // "auto" can quietly down-sample and hide faint page footers.
              detail: "high",
            },
          },
    );
  });
  parts.push({ type: "text", text: opts.userText });

  const resp = await c.chat.completions.create({
    model: opts.model,
    // Roomier than the single-doc cap: reasoning spans several images and the
    // pages[] output grows with the set. Only tokens actually used are billed.
    max_completion_tokens: 6000,
    reasoning_effort: REASONING_EFFORT,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: opts.schemaName,
        strict: true,
        schema: toStrictSchema(opts.schema) as Record<string, unknown>,
      },
    },
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: parts as never },
    ],
  });

  const u = resp.usage;
  const usage = u
    ? {
        input: u.prompt_tokens,
        output: u.completion_tokens,
        reasoning: u.completion_tokens_details?.reasoning_tokens ?? null,
      }
    : null;

  const msg = resp.choices?.[0]?.message;
  if (!msg || msg.refusal) return { raw: null, usage };
  const content = msg.content;
  if (typeof content !== "string" || content.trim() === "") {
    return { raw: null, usage };
  }
  try {
    return { raw: JSON.parse(content) as Record<string, unknown>, usage };
  } catch {
    return { raw: null, usage };
  }
}

// ── GPT-5.6 Luna: the file ORGANIZER ────────────────────────────────────────
//
// Founder ruling (2026-08-02): Terra analyzes documents — reads their actual
// content at intake — and that is the ONLY thing Terra does. Luna handles all
// organizing, and it only ever sees file NAMES plus the metadata Vylan
// already holds. Text-only calls at a fraction of Terra's price, no document
// bytes, no rate-limit exposure from bulk scans.

/** One file for Luna to look at — names and existing labels, nothing else. */
export type LunaFile = {
  id: string;
  name: string;
  currentDocType: string | null;
  currentYear: number | null;
};

export type LunaProposal = {
  id: string;
  doc_type: string | null;
  year: number | null;
  /** One of the provided folder names, or null. Only meaningful when the
   * caller supplied the client's folder list. */
  folder: string | null;
  reason: string;
};

export function organizeModel(): string {
  return process.env.OPENAI_ORGANIZE_MODEL?.trim() || "gpt-5.6-luna";
}

const LUNA_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          doc_type: { type: ["string", "null"] },
          year: { type: ["integer", "null"] },
          folder: { type: ["string", "null"] },
          reason: { type: "string" },
        },
        required: ["id", "doc_type", "year", "folder", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
};

/**
 * Ask Luna to categorize a batch of files by NAME. Returns one proposal per
 * input file; `doc_type: null` means the name is not clear enough to say —
 * which the caller treats as "make no suggestion", never as a guess.
 */
export async function organizeWithLuna(opts: {
  files: LunaFile[];
  validDocTypes: string[];
  /** The client's own folder names, when the batch is for one client. Luna
   * may match a file to one of THESE names — never to an invented one. */
  folderNames?: string[];
}): Promise<{ proposals: LunaProposal[]; usage: { input: number; output: number } | null }> {
  const c = client();
  if (!c || opts.files.length === 0) return { proposals: [], usage: null };

  const folders = opts.folderNames ?? [];
  const system = [
    "You organize documents for Canadian accounting firms using ONLY their file names.",
    "For each file, propose the most likely document type code and, when the name contains one, the 4-digit tax/statement year.",
    `Valid document type codes: ${opts.validDocTypes.join(", ")}.`,
    folders.length > 0
      ? `This client's folders: ${folders.map((f) => JSON.stringify(f)).join(", ")}. When a file's name clearly relates to exactly one of these folder names, return that folder name in "folder"; otherwise folder: null. Never invent a folder name.`
      : "The client has no folders — always return folder: null.",
    "If the name is not clear enough to be confident, return doc_type: null — a wrong label is worse than no label. The same restraint applies to folder.",
    "reason: one short sentence (max 15 words) explaining the proposal, written in the same language as the file name (French or English).",
    "Never invent codes outside the list. Never infer from anything except the provided name and current labels.",
  ].join("\n");

  const resp = await c.chat.completions.create({
    model: organizeModel(),
    max_completion_tokens: 4000,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "organize_files",
        strict: true,
        schema: LUNA_SCHEMA as Record<string, unknown>,
      },
    },
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ files: opts.files }) },
    ],
  });

  const text = resp.choices[0]?.message?.content ?? "";
  let proposals: LunaProposal[] = [];
  try {
    const parsed = JSON.parse(text) as { proposals?: LunaProposal[] };
    proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
  } catch {
    proposals = [];
  }
  const usage = resp.usage
    ? { input: resp.usage.prompt_tokens ?? 0, output: resp.usage.completion_tokens ?? 0 }
    : null;
  return { proposals, usage };
}
