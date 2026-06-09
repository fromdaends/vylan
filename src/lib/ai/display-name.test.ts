import { describe, it, expect } from "vitest";
import { buildDisplayName, fileExtension } from "./display-name";

describe("fileExtension", () => {
  it("lower-cases and keeps the dot", () => {
    expect(fileExtension("IMG_2931.PDF")).toBe(".pdf");
    expect(fileExtension("photo.JPEG")).toBe(".jpeg");
  });
  it("returns empty when there is no extension", () => {
    expect(fileExtension("scan")).toBe("");
    expect(fileExtension("trailingdot.")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
  });
  it("takes only the last extension", () => {
    expect(fileExtension("archive.tar.gz")).toBe(".gz");
  });
  it("rejects a prose 'extension' that isn't a real one", () => {
    // "John's 2024 return.final draft" -> tail has a space, not an extension.
    expect(fileExtension("return.final draft")).toBe("");
    // Over-long tail is not treated as an extension.
    expect(fileExtension("file.superlongextension")).toBe("");
  });
});

describe("buildDisplayName", () => {
  const base = { documentType: "t4", confidence: 0.95 };

  it("builds Type - Year - Issuer and preserves the original extension", () => {
    expect(
      buildDisplayName(
        { ...base, extractedYear: 2024, issuerName: "Hydro-Québec" },
        "IMG_2931.PDF",
      ),
    ).toBe("T4 - 2024 - Hydro-Québec.pdf");
  });

  it("uses the RL-1 short label (text before the em dash)", () => {
    expect(
      buildDisplayName(
        { documentType: "rl1", confidence: 0.9, extractedYear: 2024 },
        "doc.pdf",
      ),
    ).toBe("RL-1 - 2024.pdf");
  });

  it("falls back to the party name when there is no issuer", () => {
    expect(
      buildDisplayName(
        { ...base, extractedYear: 2023, issuerName: null, partyName: "Marie Tremblay" },
        "a.pdf",
      ),
    ).toBe("T4 - 2023 - Marie Tremblay.pdf");
  });

  it("drops missing parts: no issuer/party", () => {
    expect(
      buildDisplayName({ ...base, extractedYear: 2024 }, "a.pdf"),
    ).toBe("T4 - 2024.pdf");
  });

  it("drops missing parts: no year", () => {
    expect(
      buildDisplayName({ ...base, issuerName: "Costco" }, "receipt.jpg"),
    ).toBe("T4 - Costco.jpg");
  });

  it("yields just the type when nothing else is known", () => {
    expect(buildDisplayName(base, "x.pdf")).toBe("T4.pdf");
  });

  it("returns null (keep original) for unknown / other / null types", () => {
    expect(
      buildDisplayName({ documentType: "unknown", confidence: 0.99 }, "x.pdf"),
    ).toBeNull();
    // "other" is the freeform catch-all — a generic "Other - …" name is worse
    // than the client's filename, so keep the original.
    expect(
      buildDisplayName({ documentType: "other", confidence: 0.99, extractedYear: 2024 }, "x.pdf"),
    ).toBeNull();
    expect(
      buildDisplayName({ documentType: null, confidence: 0.99 }, "x.pdf"),
    ).toBeNull();
  });

  it("returns null when confidence is below the threshold", () => {
    expect(
      buildDisplayName({ documentType: "t4", confidence: 0.4, extractedYear: 2024 }, "x.pdf"),
    ).toBeNull();
    expect(
      buildDisplayName({ documentType: "t4", confidence: null }, "x.pdf"),
    ).toBeNull();
  });

  it("returns null for a code the catalog doesn't know", () => {
    expect(
      buildDisplayName({ documentType: "not_a_real_code", confidence: 0.99 }, "x.pdf"),
    ).toBeNull();
  });

  it("works without an extension on the original", () => {
    expect(
      buildDisplayName({ ...base, extractedYear: 2024 }, "scan"),
    ).toBe("T4 - 2024");
  });

  it("sanitizes path separators / reserved chars out of the issuer", () => {
    expect(
      buildDisplayName(
        { ...base, extractedYear: 2024, issuerName: "ACME / Co: <x>" },
        "a.pdf",
      ),
    ).toBe("T4 - 2024 - ACME Co x.pdf");
  });

  it("uses the French short label when asked (descriptive types differ by locale)", () => {
    // Slip codes (T4, RL-1) are identical FR/EN; this guards the locale plumbing.
    const en = buildDisplayName({ documentType: "bank_statement", confidence: 0.9 }, "s.pdf", "en");
    const fr = buildDisplayName({ documentType: "bank_statement", confidence: 0.9 }, "s.pdf", "fr");
    expect(en).not.toBeNull();
    expect(fr).not.toBeNull();
    // Both end in .pdf; FR/EN labels may differ but neither is empty.
    expect(en!.endsWith(".pdf")).toBe(true);
    expect(fr!.endsWith(".pdf")).toBe(true);
  });
});
