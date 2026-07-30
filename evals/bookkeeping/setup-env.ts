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

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  throw new Error(
    "ANTHROPIC_API_KEY is not set, so the extractor would return null for every " +
      "case and the scorecard would read as 0% accuracy. Add it to .env.local " +
      "(or export it) and run again.",
  );
}
