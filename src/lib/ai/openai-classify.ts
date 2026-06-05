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

// Reasoning effort. "medium" was stable but occasionally ran long enough on
// Vercel to exceed the 60s function limit, leaving uploads stuck on
// "Analyzing…". "low" is fast (~5-15s) and bounded — and legible-read accuracy
// comes mostly from normalizing images (webp→jpeg), not from heavy reasoning —
// so default to "low" for reliable, timely analysis. Tunable via
// OPENAI_REASONING_EFFORT (minimal | medium | high) without a code change.
const REASONING_EFFORT =
  (process.env.OPENAI_REASONING_EFFORT?.trim() as
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | undefined) || "low";

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
        image_url: { url: `data:${opts.mediaType};base64,${opts.base64}` },
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
