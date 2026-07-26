import { describe, expect, it } from "vitest";
import {
  collapseEmpties,
  parseFolderTemplate,
  parseSegment,
  renderFileName,
  renderFolderPath,
  validateFolderTemplate,
  validateNameTemplate,
} from "./template";
import { resolveYear, type FilingTokenContext } from "./tokens";
import { sanitizeCloudSegment } from "./sanitize";

// A fully-populated context: a classified 2024 T4 from Hydro-Québec for
// Marie Tremblay.
function ctx(overrides: Partial<FilingTokenContext> = {}): FilingTokenContext {
  return {
    clientName: "Marie Tremblay",
    clientType: "individual",
    firmName: "Cabinet Comptable Vylan",
    engagementTitle: "T1 2024 — Marie Tremblay",
    docTypeCode: "t4",
    docConfidence: 0.94,
    year: 2024,
    issuerName: "Hydro-Québec",
    partyName: "Marie Tremblay",
    period: null,
    date: "2025-02-28",
    originalName: "IMG_4482.jpg",
    ...overrides,
  };
}

describe("parseSegment", () => {
  it("splits literals and tokens", () => {
    expect(parseSegment("{doc_type} - {year}")).toEqual([
      { kind: "token", token: "doc_type" },
      { kind: "literal", text: " - " },
      { kind: "token", token: "year" },
    ]);
  });

  it("treats unknown tokens as literals", () => {
    expect(parseSegment("{bogus}")).toEqual([
      { kind: "literal", text: "{bogus}" },
    ]);
  });
});

describe("validateFolderTemplate", () => {
  it("accepts the default", () => {
    expect(
      validateFolderTemplate("Clients/{client_name}/{year}/{category}"),
    ).toEqual({ ok: true });
  });

  it("rejects a template without {client_name} — the wrong-client guard", () => {
    expect(validateFolderTemplate("Clients/{year}/{category}")).toEqual({
      ok: false,
      error: "missing_client_token",
    });
  });

  it("rejects unknown tokens by name", () => {
    const v = validateFolderTemplate("Clients/{client_name}/{banana}");
    expect(v).toMatchObject({ ok: false, error: "unknown_token" });
    expect((v as { unknownTokens?: string[] }).unknownTokens).toEqual([
      "{banana}",
    ]);
  });

  it("rejects empty and too-deep templates", () => {
    expect(validateFolderTemplate("  ")).toEqual({ ok: false, error: "empty" });
    expect(
      validateFolderTemplate(
        "a/b/c/d/e/f/g/h/i/{client_name}",
      ),
    ).toEqual({ ok: false, error: "too_deep" });
  });
});

describe("validateNameTemplate", () => {
  it("accepts the default", () => {
    expect(validateNameTemplate("{doc_type} - {year} - {detail}")).toEqual({
      ok: true,
    });
    expect(validateNameTemplate("")).toEqual({ ok: false, error: "empty" });
  });
});

describe("collapseEmpties", () => {
  // The engine-internal empty-token marker (template.ts EMPTY).
  const M = String.fromCharCode(0);
  it("keeps one separator when text remains on both sides", () => {
    expect(collapseEmpties(`T4 - ${M} - Hydro`)).toBe("T4 - Hydro");
  });
  it("drops trailing and leading separators", () => {
    expect(collapseEmpties(`T4 - ${M}`)).toBe("T4");
    expect(collapseEmpties(`${M} - T4`)).toBe("T4");
  });
  it("handles adjacent tokens with no separators", () => {
    expect(collapseEmpties(`Tremblay${M}2024`)).toBe("Tremblay2024");
  });
  it("collapses multiple empties", () => {
    expect(collapseEmpties(`${M} - ${M} - ${M}`)).toBe("");
  });
});

describe("renderFolderPath", () => {
  it("renders the default template fully populated", () => {
    expect(
      renderFolderPath("Clients/{client_name}/{year}/{category}", ctx(), "en"),
    ).toEqual(["Clients", "Marie Tremblay", "2024", "Federal slips"]);
  });

  it("renders category in French when the filing language is fr", () => {
    expect(
      renderFolderPath("Clients/{client_name}/{year}/{category}", ctx(), "fr"),
    ).toEqual(["Clients", "Marie Tremblay", "2024", "Feuillets fédéraux"]);
  });

  it("files under Unsorted when the year is unknown", () => {
    expect(
      renderFolderPath(
        "Clients/{client_name}/{year}",
        ctx({ year: null }),
        "en",
      ),
    ).toEqual(["Clients", "Marie Tremblay", "Unsorted"]);
    expect(
      renderFolderPath(
        "Clients/{client_name}/{year}",
        ctx({ year: null }),
        "fr",
      ),
    ).toEqual(["Clients", "Marie Tremblay", "Non classé"]);
  });

  it("files under Unsorted when the doc type (hence category) is untrusted", () => {
    expect(
      renderFolderPath(
        "Clients/{client_name}/{category}",
        ctx({ docTypeCode: "unknown", docConfidence: null }),
        "en",
      ),
    ).toEqual(["Clients", "Marie Tremblay", "Unsorted"]);
  });

  it("drops a segment whose only token collapses", () => {
    expect(
      renderFolderPath(
        "Clients/{client_name}/{issuer}",
        ctx({ issuerName: null }),
        "en",
      ),
    ).toEqual(["Clients", "Marie Tremblay"]);
  });

  it("sanitizes illegal characters and preserves accents", () => {
    expect(
      renderFolderPath(
        "Clients/{client_name}/{year}",
        ctx({ clientName: 'Société A/B: "Nord"' }),
        "en",
      ),
    ).toEqual(["Clients", "Société A B Nord", "2024"]);
  });
});

describe("renderFileName", () => {
  it("renders the default template with the original extension", () => {
    expect(renderFileName("{doc_type} - {year} - {detail}", ctx(), "en")).toBe(
      "T4 - 2024 - Hydro-Québec.jpg",
    );
  });

  it("collapses missing detail and year cleanly", () => {
    expect(
      renderFileName(
        "{doc_type} - {year} - {detail}",
        ctx({ year: null, issuerName: null, partyName: null }),
        "en",
      ),
    ).toBe("T4.jpg");
  });

  it("uses the generic label for unidentified documents", () => {
    expect(
      renderFileName(
        "{doc_type} - {year}",
        ctx({ docTypeCode: "unknown", docConfidence: 0 }),
        "en",
      ),
    ).toBe("Document - 2024.jpg");
  });

  it("does not trust a low-confidence type", () => {
    expect(
      renderFileName("{doc_type}", ctx({ docConfidence: 0.3 }), "en"),
    ).toBe("Document.jpg");
  });

  it("supports jammed templates like {client_lastname}{year}", () => {
    expect(renderFileName("{client_lastname}{year}{doc_type}", ctx(), "en")).toBe(
      "Tremblay2024T4.jpg",
    );
    expect(
      renderFileName(
        "{client_lastname}{year}_{detail}",
        ctx({ year: null, issuerName: null, partyName: null }),
        "en",
      ),
    ).toBe("Tremblay.jpg");
  });

  it("never renders an empty name", () => {
    expect(
      renderFileName("{issuer}", ctx({ issuerName: null }), "en"),
    ).toBe("Document.jpg");
  });

  it("trims a trailing dot before the extension", () => {
    expect(
      renderFileName("{detail}", ctx({ issuerName: "Maple Tech Inc." }), "en"),
    ).toBe("Maple Tech Inc.jpg");
  });
});

describe("sanitizeCloudSegment", () => {
  it("suffixes Windows reserved names", () => {
    expect(sanitizeCloudSegment("CON", 100)).toBe("CON_");
    expect(sanitizeCloudSegment("con.pdf", 100)).toBe("con_.pdf");
  });
  it("trims leading/trailing dots and spaces", () => {
    expect(sanitizeCloudSegment("  .hidden.  ", 100)).toBe("hidden");
  });
  it("returns empty when nothing survives", () => {
    expect(sanitizeCloudSegment('///"""', 100)).toBe("");
  });
});

describe("resolveYear", () => {
  const base = {
    extractedYear: null,
    engagementTaxYear: null,
    titleYear: null,
    dueDate: null,
  };
  it("prefers the document's own year", () => {
    expect(
      resolveYear({ ...base, extractedYear: 2023, engagementTaxYear: 2024 }),
    ).toBe(2023);
  });
  it("falls back doc -> tax year -> title -> due date -> null", () => {
    expect(resolveYear({ ...base, engagementTaxYear: 2024 })).toBe(2024);
    expect(resolveYear({ ...base, titleYear: 2022 })).toBe(2022);
    expect(resolveYear({ ...base, dueDate: "2025-04-30" })).toBe(2025);
    expect(resolveYear(base)).toBeNull();
  });
});

describe("parseFolderTemplate", () => {
  it("ignores empty segments from double slashes", () => {
    expect(parseFolderTemplate("a//b/").length).toBe(2);
  });
});
