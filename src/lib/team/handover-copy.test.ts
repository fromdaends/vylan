import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

// The handover copy carries THREE interpolated values across two plural clauses
// in one sentence, which is exactly the shape that breaks quietly: a malformed
// ICU plural doesn't throw, it silently drops the interpolated numbers, and
// neither tsc nor `next build` sees it. Asserting the digits are actually
// present is what catches it. (Same technique as offboard-copy.test.ts, which
// exists because this failure mode already bit once.)
const messages = { en, fr } as const;

function tr(locale: "en" | "fr") {
  return createTranslator({
    locale,
    messages: messages[locale],
    namespace: "Team",
  });
}

describe("handover copy", () => {
  for (const locale of ["en", "fr"] as const) {
    describe(locale, () => {
      it("puts both counts and the name into the hint", () => {
        const out = tr(locale)("handover_hint", {
          name: "Priya",
          engagements: 4,
          clients: 7,
        });
        expect(out).toContain("4");
        expect(out).toContain("7");
        expect(out).toContain("Priya");
      });

      it("handles zero without printing a bare 0", () => {
        // =0 branches exist so "no clients" reads as words, not as "0 clients".
        const out = tr(locale)("handover_hint", {
          name: "Priya",
          engagements: 0,
          clients: 0,
        });
        expect(out).not.toMatch(/\b0\b/);
        expect(out).toContain("Priya");
      });

      it("keeps the singular and plural forms distinct", () => {
        const one = tr(locale)("handover_hint", {
          name: "P",
          engagements: 1,
          clients: 1,
        });
        const many = tr(locale)("handover_hint", {
          name: "P",
          engagements: 3,
          clients: 3,
        });
        expect(one).not.toEqual(many);
        expect(many).toContain("3");
      });

      it("reports what moved in the success toast", () => {
        const out = tr(locale)("handover_done", {
          name: "Marc",
          engagements: 2,
          clients: 5,
        });
        expect(out).toContain("2");
        expect(out).toContain("5");
        expect(out).toContain("Marc");
      });

      it("names the person in the scope note", () => {
        // This line is the one that tells you finished work KEEPS its old name.
        const out = tr(locale)("handover_scope_note", { name: "Sarah" });
        expect(out).toContain("Sarah");
      });
    });
  }
});
