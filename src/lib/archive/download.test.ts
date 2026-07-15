import { describe, it, expect } from "vitest";
import { archiveEntryPath } from "./download";

describe("archiveEntryPath", () => {
  it("places checklist files under an ASCII 'Checklist documents' folder", () => {
    expect(archiveEntryPath("checklist", "T4.pdf", false, "en")).toBe(
      "Checklist documents/T4.pdf",
    );
  });

  it("sets rejected checklist files apart under a Rejected subfolder", () => {
    expect(archiveEntryPath("checklist", "bad.pdf", true, "en")).toBe(
      "Checklist documents/Rejected/bad.pdf",
    );
  });

  it("only checklist files get the Rejected treatment", () => {
    // rejected has no meaning for signed/final, so it is ignored there.
    expect(archiveEntryPath("signed", "letter.pdf", true, "en")).toBe(
      "Signed documents/letter.pdf",
    );
    expect(archiveEntryPath("final", "return.pdf", true, "en")).toBe(
      "Final documents/return.pdf",
    );
  });

  it("uses localized but ASCII-transliterated folder names in French", () => {
    // "Documents signés" -> accents stripped for cross-platform unzip safety.
    expect(archiveEntryPath("signed", "x.pdf", false, "fr")).toBe(
      "Documents signes/x.pdf",
    );
    expect(archiveEntryPath("final", "x.pdf", false, "fr")).toBe(
      "Documents finaux/x.pdf",
    );
    expect(archiveEntryPath("checklist", "x.pdf", false, "fr")).toBe(
      "Documents de la liste/x.pdf",
    );
  });

  it("transliterates accented leaf filenames and preserves the extension", () => {
    const path = archiveEntryPath("checklist", "Relevé 2024.pdf", false, "en");
    expect(path.startsWith("Checklist documents/")).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
    // No non-ASCII survives into the entry name.
    expect(/[^\x20-\x7E]/.test(path)).toBe(false);
  });
});
