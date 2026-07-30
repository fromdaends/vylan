import { defineConfig } from "vitest/config";
import path from "node:path";

// SEPARATE config for `npm run health` — the command-line twin of
// /settings/health.
//
// It exists because the page is owner-gated by a browser session, which a
// command line (or Claude) cannot hold. Same probes, same judgement, same
// wording; only the rendering differs. That matters: a diagnostics page nobody
// can read without signing in is not much use as a diagnostics page.
//
// Node environment (it talks to the database), and .env.local loaded the way
// Next.js would.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/lib/health/run.check.ts"],
    setupFiles: ["./scripts/load-env.ts"],
    // Send console output straight to stdout. Vitest intercepts it by default and
    // hides it entirely on a PASSING run — which for this command means the
    // report disappears exactly when everything is fine, and "no output" is
    // indistinguishable from "did not run".
    disableConsoleIntercept: true,
    testTimeout: 120000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
