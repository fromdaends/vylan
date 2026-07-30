import { defineConfig } from "vitest/config";
import path from "node:path";

// SEPARATE config for the accuracy evaluation. It is not part of `npm test`
// because it calls the real AI on every case — real money, ~a minute — and a
// suite that costs money is a suite people stop running.
//
// Node environment, not happy-dom: the Anthropic SDK refuses to start in
// anything browser-shaped, which is correct of it.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["evals/**/*.test.ts"],
    // Loads .env.local, and refuses to run without ANTHROPIC_API_KEY — without
    // it the extractor quietly returns null for every case and the scorecard
    // reads as 0% accuracy when nothing was ever asked.
    setupFiles: ["./evals/bookkeeping/setup-env.ts"],
    testTimeout: 900000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
