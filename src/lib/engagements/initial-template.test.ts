import { describe, it, expect } from "vitest";
import { resolveInitialTemplate } from "./initial-template";
import type { Template } from "@/lib/db/templates";

const tmpl = (id: string, name: string): Template => ({
  id,
  firm_id: null,
  name,
  type: "custom",
  items: [],
  created_at: "2026-01-01T00:00:00Z",
});

// First entry is the default fallback; "t2"/"t2125" are NON-first on purpose so
// the test would catch the original bug (always opening on templates[0]).
const TEMPLATES = [
  tmpl("a", "Accueil"),
  tmpl("t2", "T2 Société"),
  tmpl("t2125", "Travailleur autonome"),
];

describe("resolveInitialTemplate", () => {
  it("opens on the template whose id was passed (the clicked one)", () => {
    expect(resolveInitialTemplate(TEMPLATES, "t2")?.id).toBe("t2");
    expect(resolveInitialTemplate(TEMPLATES, "t2125")?.id).toBe("t2125");
  });

  it("falls back to the first template for a direct open (no id)", () => {
    expect(resolveInitialTemplate(TEMPLATES, undefined)?.id).toBe("a");
    expect(resolveInitialTemplate(TEMPLATES, null)?.id).toBe("a");
    expect(resolveInitialTemplate(TEMPLATES, "")?.id).toBe("a");
  });

  it("falls back to the first template for a stale or unknown id", () => {
    expect(resolveInitialTemplate(TEMPLATES, "does-not-exist")?.id).toBe("a");
  });

  it("returns undefined when there are no templates", () => {
    expect(resolveInitialTemplate([], "t2")).toBeUndefined();
    expect(resolveInitialTemplate([], undefined)).toBeUndefined();
  });
});
