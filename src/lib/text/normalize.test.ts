import { describe, it, expect } from "vitest";
import { normalizeText, searchTerms } from "./normalize";

describe("normalizeText", () => {
  it("folds case", () => {
    expect(normalizeText("Vylan")).toBe("vylan");
  });

  it("folds French accents", () => {
    expect(normalizeText("Relevé")).toBe("releve");
    expect(normalizeText("Sécurité")).toBe("securite");
    expect(normalizeText("À revoir")).toBe("a revoir");
    expect(normalizeText("Téléversement")).toBe("televersement");
  });

  it("folds the ligatures NFKD leaves alone", () => {
    // œ/æ do not decompose under NFKD, so they're mapped explicitly.
    expect(normalizeText("Sœur")).toBe("soeur");
    expect(normalizeText("œuvre")).toBe("oeuvre");
    expect(normalizeText("Æther")).toBe("aether");
  });

  it("folds compatibility ligatures NFKD does handle", () => {
    expect(normalizeText("ﬁchier")).toBe("fichier");
  });

  it("leaves plain ASCII untouched", () => {
    expect(normalizeText("invoice lock")).toBe("invoice lock");
  });

  it("is idempotent", () => {
    const once = normalizeText("Sécurité Sœur");
    expect(normalizeText(once)).toBe(once);
  });
});

describe("searchTerms", () => {
  it("splits on whitespace and folds each term", () => {
    expect(searchTerms("Relevé  d'emploi")).toEqual(["releve", "d'emploi"]);
  });

  it("drops empty terms from padding", () => {
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms("  upload  ")).toEqual(["upload"]);
  });
});
