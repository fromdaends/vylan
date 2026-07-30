// Load .env.local into process.env for a command-line run.
//
// Next.js does this for the app; a plain vitest/node process does not, so
// anything reading the database or an API key from the command line needs it.
// Deliberately does NOT assert on any particular key — that belongs to whatever
// is being run, and the health check's whole job is to REPORT a missing key
// rather than refuse to start because of one.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ENV_FILE = path.resolve(import.meta.dirname, "../.env.local");

if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Never clobber something already exported in the shell — that is how you
    // point a run at different credentials on purpose.
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
