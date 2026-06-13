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
