import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { DocTypePicker, docTypeFilter } from "./doc-type-picker";

// cmdk calls scrollIntoView, which happy-dom doesn't implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe("docTypeFilter (the search)", () => {
  // Keywords exactly as the picker builds them: [en, fr, groupHeading, ai].
  const rl31 = [
    "RL-31 — Information About a Leased Dwelling",
    "RL-31 — Renseignements sur l'occupation d'un logement",
    "Quebec slips (Relevés)",
    "Quebec RL-31 — leased-dwelling slip a landlord issues to tenants; used to claim the solidarity tax credit (Schedule D).",
  ];
  const t4aoas = [
    "T4A(OAS) — Old Age Security",
    "T4A(OAS) — Sécurité de la vieillesse",
    "Federal slips",
    "T4A(OAS) — Old Age Security pension / GIS (clients 65+).",
  ];

  it("matches by code", () => {
    expect(docTypeFilter("rl31", "rl31", rl31)).toBe(1);
  });

  it("matches English + French synonyms carried in the keywords", () => {
    expect(docTypeFilter("rl31", "solidarity", rl31)).toBe(1);
    expect(docTypeFilter("rl31", "logement", rl31)).toBe(1);
  });

  it("is accent-insensitive (folds diacritics)", () => {
    expect(docTypeFilter("rl31", "releve", rl31)).toBe(1); // → Relevés / Renseignements
    expect(docTypeFilter("t4a_oas", "securite", t4aoas)).toBe(1); // → Sécurité
  });

  it("requires ALL typed tokens (AND match)", () => {
    expect(docTypeFilter("t4a_oas", "old age", t4aoas)).toBe(1);
    expect(docTypeFilter("t4a_oas", "old zzz", t4aoas)).toBe(0);
  });

  it("returns 0 when nothing matches", () => {
    expect(docTypeFilter("rl31", "bitcoin", rl31)).toBe(0);
  });
});

describe("DocTypePicker", () => {
  it("shows the selected document's localized name on the trigger", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DocTypePicker value="rl31" onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    // role=combobox is the trigger button; it shows the real name, not the code.
    expect(screen.getByRole("combobox")).toHaveTextContent("RL-31");
  });
});
