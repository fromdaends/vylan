import { describe, it, expect } from "vitest";
import { resolveFileReason } from "./file-reason";

describe("resolveFileReason", () => {
  it("non-rejected files never carry a reason", () => {
    const ai = { issue_summary_fr: "Flou.", issue_summary_en: "Blurry." };
    expect(resolveFileReason("pending", ai, "typed")).toBeNull();
    expect(resolveFileReason("approved", ai, "typed")).toBeNull();
  });

  it("rejected: prefers the AI's bilingual client summary over a typed reason", () => {
    expect(
      resolveFileReason(
        "rejected",
        {
          issue_summary_fr: "La photo est trop floue.",
          issue_summary_en: "The photo is too blurry.",
        },
        "ignored typed reason",
      ),
    ).toEqual({
      fr: "La photo est trop floue.",
      en: "The photo is too blurry.",
    });
  });

  it("rejected: an AI summary in only one language is mirrored into both", () => {
    expect(
      resolveFileReason(
        "rejected",
        { issue_summary_fr: "Document illisible.", issue_summary_en: "" },
        null,
      ),
    ).toEqual({ fr: "Document illisible.", en: "Document illisible." });
    expect(
      resolveFileReason(
        "rejected",
        { issue_summary_fr: " ", issue_summary_en: "Unreadable document." },
        null,
      ),
    ).toEqual({ fr: "Unreadable document.", en: "Unreadable document." });
  });

  it("rejected: falls back to the accountant's typed reason when there is no AI summary", () => {
    expect(
      resolveFileReason("rejected", null, "Merci d'envoyer la version 2024."),
    ).toEqual({
      fr: "Merci d'envoyer la version 2024.",
      en: "Merci d'envoyer la version 2024.",
    });
    // whitespace-only AI summaries are treated as absent
    expect(
      resolveFileReason(
        "rejected",
        { issue_summary_fr: "  ", issue_summary_en: "  " },
        "Wrong year.",
      ),
    ).toEqual({ fr: "Wrong year.", en: "Wrong year." });
  });

  it("rejected with neither an AI summary nor a typed reason => null (no blank line)", () => {
    expect(resolveFileReason("rejected", null, null)).toBeNull();
    expect(resolveFileReason("rejected", undefined, undefined)).toBeNull();
    expect(
      resolveFileReason(
        "rejected",
        { issue_summary_fr: "", issue_summary_en: "" },
        "   ",
      ),
    ).toBeNull();
  });

  it("trims surrounding whitespace from whichever source is used", () => {
    expect(
      resolveFileReason(
        "rejected",
        { issue_summary_fr: "  Flou.  ", issue_summary_en: "  Blurry.  " },
        null,
      ),
    ).toEqual({ fr: "Flou.", en: "Blurry." });
    expect(
      resolveFileReason("rejected", null, "   Renvoyez le bon fichier.   "),
    ).toEqual({ fr: "Renvoyez le bon fichier.", en: "Renvoyez le bon fichier." });
  });
});
