import { describe, it, expect } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { ENGAGEMENT_STAGES } from "./stage";

// ⚠️ THIS TEST EXISTS BECAUSE A WRONG NAMESPACE IS INVISIBLE.
//
// next-intl renders a key it cannot find as the literal "Namespace.key" — ON
// SCREEN, at full size, in production. It is not a throw, not a console
// warning, and not a type error: `tEng("stage_collecting")` type-checks fine
// because the key exists SOMEWHERE in the message catalogue.
//
// The Work dashboard shipped calling getTranslations("Engagements") for labels
// that live under "Stage", and the result was four charts and a donut legend
// reading "Engagements.stage_collecting". `tsc --noEmit` was clean, eslint was
// clean, `next build` was clean, 5254 tests passed. The founder found it by
// looking at the page: "it's, like, the code seeping through."
//
// So the guard is the only thing that can catch it: walk the enum, and assert
// every stage has a real label in BOTH languages, in the namespace the app
// actually asks for.
describe("engagement stage labels resolve in the Stage namespace", () => {
  // Indexed straight off the typed import — a blanket
  // `as Record<string, Record<string, string>>` does NOT fit this catalogue
  // (some namespaces nest), and casting it anyway is the kind of thing only
  // `tsc --noEmit` objects to. It passed `next build` and vitest happily.
  const catalogues = [
    ["en", en.Stage as Record<string, string>],
    ["fr", fr.Stage as Record<string, string>],
  ] as const;

  for (const [lang, stageMessages] of catalogues) {
    it(`has a ${lang} label for every stage`, () => {
      for (const stage of ENGAGEMENT_STAGES) {
        const value = stageMessages[`stage_${stage}`];
        expect(value, `${lang}: Stage.stage_${stage} is missing`).toBeTruthy();
        // A label that still looks like a key is the exact failure this test
        // is about — catch it whether it comes from a miss or a bad paste.
        expect(value).not.toMatch(/^[A-Z][A-Za-z]*\./);
      }
    });
  }

  it("keeps the two languages on the same set of stages", () => {
    // A stage translated in one language and not the other renders the raw key
    // for half the firm, which is the same bug wearing a different hat.
    expect(Object.keys(en.Stage).sort()).toEqual(Object.keys(fr.Stage).sort());
  });

  it("covers the dashboard's own strings in both languages too", () => {
    // The dashboard added twenty-odd keys at once; one typo'd namespace there
    // would print the same way.
    const enDash = Object.keys(en.Dashboard).filter((k) => k.startsWith("dash_"));
    const frDash = Object.keys(fr.Dashboard).filter((k) => k.startsWith("dash_"));
    expect(enDash.length).toBeGreaterThan(0);
    expect(enDash.sort()).toEqual(frDash.sort());
  });
});
