import { describe, it, expect } from "vitest";
import {
  parseSetAssessment,
  computeFilesSignature,
  decideSetRouting,
  SET_INCOMPLETE_CONFIDENCE_BAR,
  type SetAssessmentPage,
} from "./set-assessment";

// These cover the PURE output-parsing layer (parseSetAssessment) and the
// staleness fingerprint (computeFilesSignature). The model call + DB I/O in
// processSetAssessmentJob are integration-shaped and exercised live; the
// tolerant-parse rules below are where the correctness risk lives.

const IDS = ["fileA", "fileB", "fileC", "fileD"];

describe("parseSetAssessment", () => {
  it("maps a complete 4-page set, anchoring image_index → file_id", () => {
    const raw = {
      conclusion_en: "Pages 1-4 of 4 are present; the statement is complete.",
      conclusion_fr: "Les pages 1 à 4 sur 4 sont présentes; le relevé est complet.",
      confidence: 0.94,
      pages: [
        { image_index: 1, position: 1, of_total: 4, placement: "printed", note: "" },
        { image_index: 2, position: 2, of_total: 4, placement: "printed", note: "" },
        { image_index: 3, position: 3, of_total: 4, placement: "inferred", note: "footer cut off; placed by running balance" },
        { image_index: 4, position: 4, of_total: 4, placement: "printed", note: "" },
      ],
      flags: [],
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out).not.toBeNull();
    expect(out!.confidence).toBe(0.94);
    expect(out!.pages).toHaveLength(4);
    expect(out!.pages[0]!.file_id).toBe("fileA");
    expect(out!.pages[2]).toMatchObject<Partial<SetAssessmentPage>>({
      file_id: "fileC",
      position: 3,
      of_total: 4,
      placement: "inferred",
    });
    expect(out!.flags).toEqual([]);
  });

  it("names a missing page in the conclusion and keeps unconfirmed placements honest", () => {
    const raw = {
      conclusion_en: "Pages 1, 2 and 4 of 4 are present; page 3 is missing.",
      conclusion_fr: "Les pages 1, 2 et 4 sur 4 sont présentes; la page 3 est manquante.",
      confidence: 0.88,
      pages: [
        { image_index: 1, position: 1, of_total: 4, placement: "printed", note: "" },
        { image_index: 2, position: 2, of_total: 4, placement: "printed", note: "" },
        { image_index: 3, position: 4, of_total: 4, placement: "printed", note: "" },
      ],
      flags: ["Page 3 of 4 is missing."],
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out!.conclusion_en).toContain("page 3 is missing");
    expect(out!.flags).toEqual(["Page 3 of 4 is missing."]);
  });

  it("defaults an unknown placement value to the conservative 'unconfirmed'", () => {
    const raw = {
      conclusion_en: "Mixed set.",
      conclusion_fr: "Ensemble mixte.",
      confidence: 0.5,
      pages: [{ image_index: 1, position: null, of_total: null, placement: "guessed", note: "" }],
      flags: [],
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out!.pages[0]!.placement).toBe("unconfirmed");
  });

  it("drops page entries whose image_index points at no real file", () => {
    const raw = {
      conclusion_en: "ok",
      conclusion_fr: "ok",
      confidence: 0.9,
      pages: [
        { image_index: 1, position: 1, of_total: 2, placement: "printed", note: "" },
        { image_index: 99, position: 2, of_total: 2, placement: "printed", note: "" }, // hallucinated
        { image_index: 0, position: 1, of_total: 2, placement: "printed", note: "" }, // out of range
      ],
      flags: [],
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out!.pages).toHaveLength(1);
    expect(out!.pages[0]!.file_id).toBe("fileA");
  });

  it("keeps only the first entry when a file is listed twice", () => {
    const raw = {
      conclusion_en: "ok",
      conclusion_fr: "ok",
      confidence: 0.9,
      pages: [
        { image_index: 2, position: 2, of_total: 4, placement: "printed", note: "first" },
        { image_index: 2, position: 3, of_total: 4, placement: "inferred", note: "dup" },
      ],
      flags: [],
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out!.pages).toHaveLength(1);
    expect(out!.pages[0]).toMatchObject({ file_id: "fileB", position: 2, note: "first" });
  });

  it("clamps confidence into [0,1] and mirrors a missing-language conclusion", () => {
    const raw = {
      conclusion_en: "English only.",
      conclusion_fr: "",
      confidence: 1.7,
      pages: [],
      flags: [],
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out!.confidence).toBe(1);
    expect(out!.conclusion_fr).toBe("English only."); // mirrored from EN
  });

  it("parses each valid outcome verbatim", () => {
    for (const outcome of ["complete", "incomplete", "unplaceable", "not_a_set"]) {
      const out = parseSetAssessment(
        { conclusion_en: "x", conclusion_fr: "x", confidence: 0.9, outcome, pages: [], flags: [] },
        IDS,
      );
      expect(out!.outcome).toBe(outcome);
    }
  });

  it("keeps the client ask only on an incomplete set", () => {
    const incomplete = parseSetAssessment(
      {
        conclusion_en: "page 3 missing",
        conclusion_fr: "page 3 manquante",
        confidence: 0.9,
        outcome: "incomplete",
        client_request_fr: "Il manque la page 3 sur 4. Pourriez-vous l'ajouter?",
        client_request_en: "Page 3 of 4 is missing. Could you add it?",
        pages: [],
        flags: [],
      },
      IDS,
    );
    expect(incomplete!.client_request_fr).toContain("page 3");
    expect(incomplete!.client_request_en).toContain("Page 3");

    // A stray client ask on a COMPLETE set must be scrubbed — never leak to a client.
    const complete = parseSetAssessment(
      {
        conclusion_en: "complete",
        conclusion_fr: "complet",
        confidence: 0.95,
        outcome: "complete",
        client_request_fr: "oops should not be here",
        client_request_en: "oops should not be here",
        pages: [],
        flags: [],
      },
      IDS,
    );
    expect(complete!.client_request_fr).toBe("");
    expect(complete!.client_request_en).toBe("");
  });

  it("defaults a missing or junk outcome to the conservative 'unplaceable'", () => {
    const missing = parseSetAssessment(
      { conclusion_en: "x", conclusion_fr: "x", confidence: 0.9, pages: [], flags: [] },
      IDS,
    );
    expect(missing!.outcome).toBe("unplaceable");
    const junk = parseSetAssessment(
      { conclusion_en: "x", conclusion_fr: "x", confidence: 0.9, outcome: "mostly", pages: [], flags: [] },
      IDS,
    );
    expect(junk!.outcome).toBe("unplaceable");
  });

  it("returns null when there is no usable conclusion at all", () => {
    const out = parseSetAssessment(
      { conclusion_en: "", conclusion_fr: "", confidence: 0.9, pages: [], flags: [] },
      IDS,
    );
    expect(out).toBeNull();
  });

  it("tolerates a non-array pages/flags field", () => {
    const out = parseSetAssessment(
      { conclusion_en: "ok", conclusion_fr: "ok", confidence: 0.5, pages: null, flags: "nope" },
      IDS,
    );
    expect(out!.pages).toEqual([]);
    expect(out!.flags).toEqual([]);
  });

  it("rejects junk position/of_total values (non-integer, negative, huge)", () => {
    const raw = {
      conclusion_en: "ok",
      conclusion_fr: "ok",
      confidence: 0.9,
      pages: [{ image_index: 1, position: -3, of_total: 99999, placement: "printed", note: "" }],
      flags: [],
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out!.pages[0]!.position).toBeNull();
    expect(out!.pages[0]!.of_total).toBeNull();
  });

  it("caps flags at 12", () => {
    const raw = {
      conclusion_en: "ok",
      conclusion_fr: "ok",
      confidence: 0.9,
      pages: [],
      flags: Array.from({ length: 20 }, (_, i) => `flag ${i}`),
    };
    const out = parseSetAssessment(raw, IDS);
    expect(out!.flags).toHaveLength(12);
  });
});

describe("parseSetAssessment — content duplicates", () => {
  function withPages(pages: unknown[]) {
    return parseSetAssessment(
      { conclusion_en: "x", conclusion_fr: "x", confidence: 0.9, outcome: "complete", pages, flags: [] },
      IDS,
    );
  }

  it("maps a later file's duplicate pointer to the earlier file's id", () => {
    const out = withPages([
      { image_index: 1, position: 1, of_total: 1, placement: "printed", note: "", duplicate_of_image_index: null },
      { image_index: 3, position: 1, of_total: 1, placement: "printed", note: "", duplicate_of_image_index: 1 },
    ]);
    expect(out!.pages.find((p) => p.file_id === "fileC")!.duplicate_of_file_id).toBe("fileA");
    expect(out!.pages.find((p) => p.file_id === "fileA")!.duplicate_of_file_id).toBeNull();
  });

  it("ignores a forward pointer (earlier file pointing at a later one)", () => {
    const out = withPages([
      { image_index: 1, position: 1, of_total: 1, placement: "printed", note: "", duplicate_of_image_index: 3 },
    ]);
    expect(out!.pages[0]!.duplicate_of_file_id).toBeNull();
  });

  it("ignores a self pointer and an out-of-range pointer", () => {
    const out = withPages([
      { image_index: 2, position: 1, of_total: 1, placement: "printed", note: "", duplicate_of_image_index: 2 },
      { image_index: 4, position: 1, of_total: 1, placement: "printed", note: "", duplicate_of_image_index: 99 },
    ]);
    expect(out!.pages.every((p) => p.duplicate_of_file_id === null)).toBe(true);
  });

  it("defaults to null when the duplicate field is absent", () => {
    const out = withPages([
      { image_index: 1, position: 1, of_total: 1, placement: "printed", note: "" },
    ]);
    expect(out!.pages[0]!.duplicate_of_file_id).toBeNull();
  });
});

describe("decideSetRouting", () => {
  const bar = SET_INCOMPLETE_CONFIDENCE_BAR;

  it("asks the client for a confident missing page only when the firm opted in", () => {
    expect(
      decideSetRouting({ outcome: "incomplete", confidence: bar, autoRequestMissingPages: true }),
    ).toBe("ask_client");
    expect(
      decideSetRouting({ outcome: "incomplete", confidence: bar, autoRequestMissingPages: false }),
    ).toBe("flag_accountant");
  });

  it("never asks the client below the confidence bar, even with the setting on", () => {
    expect(
      decideSetRouting({ outcome: "incomplete", confidence: bar - 0.01, autoRequestMissingPages: true }),
    ).toBe("flag_accountant");
  });

  it("always sends an unplaceable set to the accountant, regardless of the setting", () => {
    expect(
      decideSetRouting({ outcome: "unplaceable", confidence: 0.99, autoRequestMissingPages: true }),
    ).toBe("flag_accountant");
    expect(
      decideSetRouting({ outcome: "unplaceable", confidence: 0.99, autoRequestMissingPages: false }),
    ).toBe("flag_accountant");
  });

  it("does nothing for a complete set or a pile of separate documents", () => {
    expect(
      decideSetRouting({ outcome: "complete", confidence: 0.99, autoRequestMissingPages: true }),
    ).toBe("none");
    expect(
      decideSetRouting({ outcome: "not_a_set", confidence: 0.99, autoRequestMissingPages: true }),
    ).toBe("none");
  });
});

describe("computeFilesSignature", () => {
  it("produces a sorted, stable '<id>:<hash>' signature", () => {
    const sig = computeFilesSignature([
      { id: "b", content_hash: "h2" },
      { id: "a", content_hash: "h1" },
    ]);
    expect(sig).toEqual(["a:h1", "b:h2"]);
  });

  it("is order-independent (same files → same signature)", () => {
    const a = computeFilesSignature([
      { id: "x", content_hash: "1" },
      { id: "y", content_hash: "2" },
    ]);
    const b = computeFilesSignature([
      { id: "y", content_hash: "2" },
      { id: "x", content_hash: "1" },
    ]);
    expect(a).toEqual(b);
  });

  it("represents a null hash as an empty segment", () => {
    expect(computeFilesSignature([{ id: "z", content_hash: null }])).toEqual(["z:"]);
  });
});
