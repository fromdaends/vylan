// Copy guard for the Repeating namespace.
//
// Nothing in this repo enforces en/fr parity — no CI check, no build step — and
// a missing key throws at RENDER, for French users only, on a page English
// testing never exercises. A malformed ICU clause does the same. Both are
// invisible to tsc and to `next build`, so they get asserted here against the
// real message files.

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

const LOCALES = ["en", "fr"] as const;
const messages = { en, fr };

const t = (locale: (typeof LOCALES)[number], namespace: "Repeating" | "Audit") =>
  createTranslator({ locale, messages: messages[locale], namespace });

describe("Repeating namespace parity", () => {
  it("has the same keys in both languages", () => {
    const enKeys = Object.keys(en.Repeating).sort();
    const frKeys = Object.keys(fr.Repeating).sort();
    expect(frKeys).toEqual(enKeys);
  });

  it("has no empty strings in either language", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale].Repeating)) {
        expect(String(value).trim(), `${locale}.Repeating.${key}`).not.toBe("");
      }
    }
  });

  it("carries the sidebar label in both languages", () => {
    expect(en.App.nav_repeating).toBeTruthy();
    expect(fr.App.nav_repeating).toBeTruthy();
  });
});

describe("Repeating interpolated copy", () => {
  // Each of these takes a placeholder. If the clause is malformed, next-intl
  // drops the interpolated value — so asserting the value APPEARS is what
  // makes these tests able to fail.
  it.each(LOCALES)("formats the schedule rhythm sentences (%s)", (locale) => {
    const tr = t(locale, "Repeating");
    expect(tr("repeats_monthly_on", { day: "15th" })).toContain("15th");
    expect(tr("repeats_quarterly_on", { day: "1er" })).toContain("1er");
    expect(tr("repeats_yearly_on", { day: "30th" })).toContain("30th");
    const custom = tr("repeats_custom_on", { months: 2, day: "1st" });
    expect(custom).toContain("2");
    expect(custom).toContain("1st");
  });

  it.each(LOCALES)("formats the next-run countdown (%s)", (locale) => {
    expect(t(locale, "Repeating")("next_in_days", { days: 4 })).toContain("4");
  });

  it.each(LOCALES)("formats every toast that names a schedule (%s)", (locale) => {
    const tr = t(locale, "Repeating");
    for (const key of ["paused_toast", "resumed_toast", "stopped_toast"] as const) {
      expect(tr(key, { title: "Monthly bookkeeping" }), key).toContain(
        "Monthly bookkeeping",
      );
    }
    expect(
      tr("assignee_toast", { title: "Monthly bookkeeping", name: "Sarah" }),
    ).toContain("Sarah");
  });

  it.each(LOCALES)("formats the stop confirmation and the stopped count (%s)", (locale) => {
    const tr = t(locale, "Repeating");
    expect(tr("stop_confirm_body", { title: "Acme monthly" })).toContain(
      "Acme monthly",
    );
    expect(tr("show_stopped", { count: 5 })).toContain("5");
    expect(tr("stopped_on", { date: "3 March" })).toContain("3 March");
    expect(tr("action_menu", { title: "Acme monthly" })).toContain("Acme monthly");
  });
});

describe("audit labels for the recurring actions", () => {
  // Registered in AUDIT_ACTIONS; without a matching label the audit log renders
  // the raw snake_case code.
  const KEYS = [
    "action_recurrence_paused",
    "action_recurrence_resumed",
    "action_recurrence_ended",
    "action_series_reassigned",
  ] as const;

  it.each(LOCALES)("has a human label for each (%s)", (locale) => {
    for (const key of KEYS) {
      const label = t(locale, "Audit")(key);
      expect(label, key).toBeTruthy();
      // A missing key makes next-intl echo the path back.
      expect(label, key).not.toContain("Audit.");
    }
  });
});
