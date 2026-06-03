import { describe, it, expect } from "vitest";
import { buildContentDisposition } from "./content-disposition";

describe("buildContentDisposition", () => {
  it("uses `inline` for preview and `attachment` for download", () => {
    expect(buildContentDisposition("a.pdf", false)).toMatch(/^inline;/);
    expect(buildContentDisposition("a.pdf", true)).toMatch(/^attachment;/);
  });

  it("keeps a simple ASCII name verbatim in the fallback param", () => {
    const h = buildContentDisposition("Statement_2024.pdf", false);
    expect(h).toContain('filename="Statement_2024.pdf"');
  });

  it("preserves accented Québec names via the RFC 5987 filename* param", () => {
    const h = buildContentDisposition("Relevé_Été_Tremblay.pdf", true);
    // The UTF-8 param carries the true name (percent-encoded)...
    expect(h).toContain(
      "filename*=UTF-8''Relev%C3%A9_%C3%89t%C3%A9_Tremblay.pdf",
    );
    // ...while the ASCII fallback is pure printable ASCII (accents replaced),
    // never raw multi-byte characters, and keeps the extension.
    const asciiName = h.match(/filename="([^"]*)"/)?.[1] ?? "";
    expect(asciiName).toMatch(/^[\x20-\x7E]+$/);
    expect(asciiName.endsWith("Tremblay.pdf")).toBe(true);
    expect(asciiName).not.toMatch(/[éÉ]/);
  });

  it("neutralises header-injection attempts in the filename", () => {
    const evil = 'x";\r\nSet-Cookie: a=b.pdf';
    const h = buildContentDisposition(evil, false);
    // No raw CR/LF or stray quote can survive into the header value.
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).not.toContain('x";');
  });

  it("falls back to a non-empty name when the input is all stripped", () => {
    const h = buildContentDisposition("\r\n", false);
    expect(h).toContain('filename="');
    expect(h).not.toMatch(/filename=""/);
  });
});
