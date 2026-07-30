// Load .env.local into process.env for the accuracy evaluation.
//
// WHY THIS EXISTS. extractTransaction returns null when ANTHROPIC_API_KEY is
// missing — a deliberate, quiet no-op so the app degrades instead of crashing.
// Vitest does not populate process.env from .env.local, so the eval ran to
// completion in 296ms with every case reporting "EXTRACTION RETURNED NOTHING"
// and a scorecard full of zeroes. It looked like a catastrophic accuracy
// regression; the AI had simply never been called.
//
// The readable-cases assertion caught it, which is the only reason it did not
// get read as a result. Belt and braces: the check below fails loudly and
// immediately instead, naming the actual cause.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ENV_FILE = path.resolve(import.meta.dirname, "../../.env.local");

if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Never clobber a value already exported in the shell — that is how you
    // point a run at a different key on purpose.
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

// WHICH AI THE SCORE ACTUALLY DESCRIBES.
//
// getProvider() (src/lib/ai/classify.ts) defaults to Anthropic and flips to
// OpenAI when AI_CLASSIFIER_PROVIDER=openai. Both the classifier and the
// transaction extractor ride that one switch.
//
// The first expanded run of this harness scored 23 documents on Claude while
// PRODUCTION was set to OpenAI, because .env.local sets no provider and the
// default is Anthropic. The numbers were real, they just described a model the
// product does not use — which is a subtler way to be wrong than a crash.
//
// So: fail on the key for the SELECTED provider, and name the selection in the
// message. A score is meaningless unless you know what produced it.
const provider =
  process.env.AI_CLASSIFIER_PROVIDER?.toLowerCase() === "openai"
    ? "openai"
    : "anthropic";

const keyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";

if (!process.env[keyVar]?.trim()) {
  throw new Error(
    `AI_CLASSIFIER_PROVIDER selects "${provider}", but ${keyVar} is not set — ` +
      "the extractor returns null for every case and the scorecard would read as " +
      "0% accuracy while nothing was ever asked.\n\n" +
      `Set ${keyVar} in .env.local, or point the run at the other provider:\n` +
      "  AI_CLASSIFIER_PROVIDER=openai npm run eval:bookkeeping   (what production uses)\n" +
      "  AI_CLASSIFIER_PROVIDER=anthropic npm run eval:bookkeeping\n\n" +
      "Match production, or the number describes a model you do not ship.",
  );
}

if (!process.env.AI_CLASSIFIER_PROVIDER?.trim()) {
  console.warn(
    "\n[eval] AI_CLASSIFIER_PROVIDER is not set, so this run uses ANTHROPIC by " +
      "default. If production is set to openai, this score does NOT describe " +
      "production. Re-run with AI_CLASSIFIER_PROVIDER=openai to match it.\n",
  );
}
