import { describe, it, expect } from "vitest";
import { localizedTemplateName } from "@/lib/templates/builtin-names";

const builtin = (id: string, name: string) => ({ id, firm_id: null, name });

describe("localizedTemplateName", () => {
  it("returns the English overlay for a built-in on the English locale", () => {
    const t1 = builtin("00000000-0000-0000-0000-000000000001", "T1 — Particulier");
    expect(localizedTemplateName(t1, "en")).toBe("T1 — Personal");
  });

  it("keeps the stored French name for a built-in on the French locale", () => {
    const t1 = builtin("00000000-0000-0000-0000-000000000001", "T1 — Particulier");
    expect(localizedTemplateName(t1, "fr")).toBe("T1 — Particulier");
  });

  it("never overlays a firm-created template, even on English", () => {
    const firmTemplate = {
      id: "00000000-0000-0000-0000-000000000001", // same id shape, but firm-owned
      firm_id: "firm-123",
      name: "Mon modèle",
    };
    expect(localizedTemplateName(firmTemplate, "en")).toBe("Mon modèle");
  });

  it("falls back to the stored name for an unknown built-in id", () => {
    const unknown = builtin("00000000-0000-0000-0000-0000000000ff", "Nouveau modèle intégré");
    expect(localizedTemplateName(unknown, "en")).toBe("Nouveau modèle intégré");
  });

  it("covers GST/QST and onboarding overlays", () => {
    const gst = builtin("00000000-0000-0000-0000-000000000008", "TPS/TVQ — Déclaration");
    const onboarding = builtin("00000000-0000-0000-0000-00000000000a", "Accueil — nouveau client");
    expect(localizedTemplateName(gst, "en")).toBe("GST/QST return");
    expect(localizedTemplateName(onboarding, "en")).toBe("New client onboarding");
  });
});
