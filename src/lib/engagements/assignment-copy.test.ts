// Copy + parity guard for the assignment work. Same reasoning as
// offboard-copy.test.ts: nothing in this repo enforces en/fr parity, and a
// malformed ICU clause or a missing key throws at RENDER — for French users
// only, on a control English testing never exercises. Neither tsc nor
// `next build` sees it.

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

const LOCALES = ["en", "fr"] as const;
const messages = { en, fr };

const t = (
  locale: (typeof LOCALES)[number],
  namespace: "Engagements" | "Audit",
) => createTranslator({ locale, messages: messages[locale], namespace });

describe("assignment copy", () => {
  it.each(LOCALES)("has the unassign control label (%s)", (locale) => {
    const label = t(locale, "Engagements")("unassign");
    expect(label).toBeTruthy();
    expect(label).not.toContain("Engagements.");
  });

  it.each(LOCALES)("formats the handoff attribution with a name (%s)", (locale) => {
    // A malformed clause drops the interpolated values, so asserting they
    // APPEAR is what makes this able to fail.
    const out = t(locale, "Engagements")("handoff_from", {
      name: "Sarah",
      date: "3 March 2026",
    });
    expect(out).toContain("Sarah");
    expect(out).toContain("3 March 2026");
  });

  it.each(LOCALES)("formats the handoff attribution without a name (%s)", (locale) => {
    // actor_id is nullable and system actors have none, so this branch is real.
    const out = t(locale, "Engagements")("handoff_at", { date: "3 March 2026" });
    expect(out).toContain("3 March 2026");
  });

  it.each(LOCALES)("labels the unassign action in the audit log (%s)", (locale) => {
    // Registered in AUDIT_ACTIONS; without a label the audit log renders the
    // raw snake_case code.
    const label = t(locale, "Audit")("action_engagement_unassigned");
    expect(label).toBeTruthy();
    expect(label).not.toContain("Audit.");
  });
});

describe("en/fr parity for the keys this change added", () => {
  it("defines every new key in both languages", () => {
    for (const key of ["unassign", "handoff_from", "handoff_at"] as const) {
      expect(Object.keys(en.Engagements), `en.${key}`).toContain(key);
      expect(Object.keys(fr.Engagements), `fr.${key}`).toContain(key);
    }
    expect(Object.keys(en.Audit)).toContain("action_engagement_unassigned");
    expect(Object.keys(fr.Audit)).toContain("action_engagement_unassigned");
  });
});
