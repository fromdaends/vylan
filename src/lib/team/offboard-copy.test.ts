// The guarded-offboarding copy is ICU-pluralised in two languages, and a
// malformed plural clause throws at RENDER time — not at build, not in tsc.
// The dialog only appears when you are removing a teammate who holds work, so
// a broken string here would surface as a crash at the worst possible moment.
// These assertions format the real messages from the real message files.

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

const t = (locale: "en" | "fr") =>
  createTranslator({
    locale,
    messages: locale === "en" ? en : fr,
    namespace: "Team",
  });

describe("offboard dialog copy", () => {
  it.each(["en", "fr"] as const)(
    "formats the schedules variant with plural counts (%s)",
    (locale) => {
      const out = t(locale)("offboard_holds_with_schedules", {
        name: "Sarah",
        engagements: 4,
        clients: 12,
        schedules: 6,
      });
      expect(out).toContain("Sarah");
      expect(out).toContain("4");
      expect(out).toContain("12");
      expect(out).toContain("6");
    },
  );

  it.each(["en", "fr"] as const)(
    "formats the schedules variant at the singular boundary (%s)",
    (locale) => {
      // ICU `one` vs `other` — the case a plain interpolation would get wrong.
      const out = t(locale)("offboard_holds_with_schedules", {
        name: "Marc",
        engagements: 1,
        clients: 1,
        schedules: 1,
      });
      expect(out).toContain("Marc");
      expect(out.length).toBeGreaterThan(0);
    },
  );

  it.each(["en", "fr"] as const)(
    "formats the schedules variant with zero engagements and zero clients (%s)",
    (locale) => {
      // The exact case this bug fix exists for: someone whose ENTIRE footprint
      // is repeating schedules. Before 0940 this dialog never appeared at all.
      const out = t(locale)("offboard_holds_with_schedules", {
        name: "Priya",
        engagements: 0,
        clients: 0,
        schedules: 3,
      });
      expect(out).toContain("Priya");
      expect(out).toContain("3");
    },
  );

  it.each(["en", "fr"] as const)(
    "still formats the original no-schedules variant (%s)",
    (locale) => {
      const out = t(locale)("offboard_holds", {
        name: "Dan",
        engagements: 2,
        clients: 0,
      });
      expect(out).toContain("Dan");
      expect(out).toContain("2");
    },
  );

  it.each(["en", "fr"] as const)(
    "has both privacy toast strings (%s)",
    (locale) => {
      // The OFF direction now does real work (bulk un-private), so it needs
      // its own confirmation — silence would read as "nothing happened".
      expect(t(locale)("firm_private_default_enabled").length).toBeGreaterThan(0);
      expect(t(locale)("firm_private_default_disabled").length).toBeGreaterThan(
        0,
      );
    },
  );
});
