// @vitest-environment node
//
// Renders every case to an image WITHOUT calling the AI — so you can look at the
// documents, or refresh them after editing a case, for free.
//
//   npm run eval:bookkeeping -- render
//
// Worth doing whenever you add a case or change a capture mode: an illegible
// render is a broken case, not a hard one, and it will quietly drag the score
// down while telling you nothing. Open evals/bookkeeping/rendered/ and read them
// the way the model has to.

import { describe, it, expect } from "vitest";
import { CASES } from "./cases";
import { renderMissing, captureOf, imagePath } from "./render";
import { existsSync, statSync } from "node:fs";

describe("case rendering", () => {
  it(
    "produces a readable image for every case",
    () => {
      expect(
        renderMissing(),
        "could not render these — is a Chrome-family browser installed?",
      ).toEqual([]);

      const summary = CASES.map((c) => {
        const p = imagePath(c);
        const kb = existsSync(p) ? Math.round(statSync(p).size / 1024) : 0;
        return `${c.id.padEnd(30)} ${captureOf(c).padEnd(8)} ${String(kb).padStart(4)} KB`;
      });
      console.log(
        ["", "RENDERED", "─".repeat(56), ...summary, ""].join("\n"),
      );

      // A capture that produced almost no bytes is a blank page — the case
      // would score as "unreadable" and the cause would look like the model.
      for (const c of CASES) {
        const kb = statSync(imagePath(c)).size / 1024;
        expect(kb, `${c.id} rendered to almost nothing — check its capture CSS`)
          .toBeGreaterThan(4);
      }
    },
    900_000,
  );
});
