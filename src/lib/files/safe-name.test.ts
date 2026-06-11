import { describe, it, expect } from "vitest";
import { safeStorageName } from "./safe-name";

// Storage keys must stay inside Supabase's allowed charset (ASCII word chars
// + a short punctuation list). Accented French filenames broke every upload
// whose name contained one — the founder's "Régie de l'assurance
// maladie.jpeg" failed deterministically while "IMG_3303.jpeg" passed.
describe("safeStorageName", () => {
  it("strips accents instead of dropping the letters", () => {
    expect(safeStorageName("Régie de l'assurance maladie.jpeg")).toBe(
      "Regie_de_l_assurance_maladie.jpeg",
    );
    expect(safeStorageName("reçu_déménagement.pdf")).toBe(
      "recu_demenagement.pdf",
    );
  });

  it("keeps plain ASCII names intact", () => {
    expect(safeStorageName("IMG_3303.jpeg")).toBe("IMG_3303.jpeg");
    expect(safeStorageName("T4-2025.pdf")).toBe("T4-2025.pdf");
  });

  it("replaces path separators and exotic characters", () => {
    expect(safeStorageName("a/b\\c.pdf")).toBe("a_b_c.pdf");
    expect(safeStorageName("facture 🧾 mars.pdf")).toBe("facture_mars.pdf");
  });

  it("collapses runs and trims leading/trailing separators", () => {
    expect(safeStorageName("  ___doc   name___.pdf")).toBe("doc_name_.pdf");
  });

  it("caps the length", () => {
    expect(safeStorageName("x".repeat(500) + ".pdf").length).toBeLessThanOrEqual(
      120,
    );
  });

  it("never returns an empty key", () => {
    expect(safeStorageName("éàç")).not.toBe("");
    expect(safeStorageName("🧾🧾🧾")).toBe("file");
    expect(safeStorageName("")).toBe("file");
  });
});
