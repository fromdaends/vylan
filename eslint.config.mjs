import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local-only git worktrees (gitignored). Scanning them double-reports
    // every issue and there's nothing actionable inside them.
    ".claude/worktrees/**",
    // Vendored, minified third-party assets served statically (e.g. the
    // pdf.js worker `public/pdf/pdf.worker.min.mjs`). This is not our
    // source code and must never be linted — minified vendor bundles trip
    // rules like no-this-alias / no-unused-expressions by design.
    "public/**",
  ]),
]);

export default eslintConfig;
