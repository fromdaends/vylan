import { defineConfig } from "vitest/config";
import path from "node:path";

// SEPARATE config for the `*.check.ts` files — the things you RUN when you want
// to know something about the live system, as opposed to the tests that run on
// every change.
//
// They are not part of `npm test` on purpose: they need a live database or a
// live QuickBooks connection, and the main include (`*.{test,spec}.ts`) does not
// match `.check.ts`. They exist because the alternative is a diagnostics page
// nobody can read without a browser session, or a claim nobody can re-verify.
//
// Node environment (they talk to the database), and .env.local loaded the way
// Next.js would.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/lib/**/*.check.ts"],
    setupFiles: ["./scripts/load-env.ts"],
    // Send console output straight to stdout. Vitest intercepts it by default and
    // hides it entirely on a PASSING run — which for these commands means the
    // report disappears exactly when everything is fine, and "no output" is
    // indistinguishable from "did not run".
    disableConsoleIntercept: true,
    testTimeout: 120000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
