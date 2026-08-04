import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

// A wrong next-intl key renders as "Dashboard.tasks_title" ON SCREEN and passes
// tsc, eslint, the whole test suite and a production build without a word. It
// has now shipped twice: once on the task kinds, and once on the Overview's
// heading — which the founder saw before I did, in a screenshot.
//
// So this walks the components that draw the task screens, finds every literal
// t("…") call, and checks the key exists in BOTH locales. It is deliberately
// source-text based rather than clever: a rendering test would only cover the
// branches it happened to render, and the keys that break are the ones in the
// branch nobody thought about.
//
// ── WHAT IT CANNOT SEE ─────────────────────────────────────────────────────
//
// Keys built from a variable — t(`kind_${kind}`) — are skipped here, because
// the value is not in the source. Those have their own guard where the enum
// lives (see lib/tasks/kinds.test.ts), which is the right place: the list of
// possible values is the thing that must be walked.

/** Which namespace each file's `t` is bound to. */
const FILES: { path: string; namespaces: Record<string, string> }[] = [
  {
    path: "src/components/dashboard/tasks-overview-card.tsx",
    namespaces: { t: "Dashboard" },
  },
  {
    path: "src/components/engagements/tasks-table.tsx",
    namespaces: { t: "Engagements", tStatus: "Clients" },
  },
  {
    path: "src/components/engagements/task-detail-panel.tsx",
    namespaces: { t: "Engagements" },
  },
  {
    path: "src/components/engagements/add-task-dialog.tsx",
    namespaces: { t: "Engagements" },
  },
  {
    path: "src/components/engagements/subtask-list.tsx",
    namespaces: { t: "Engagements" },
  },
  {
    path: "src/components/engagements/engagement-tabs.tsx",
    namespaces: { t: "Engagements" },
  },
  {
    path: "src/components/settings/task-statuses-editor.tsx",
    namespaces: { t: "Settings" },
  },
];

const MESSAGES: Record<string, Record<string, unknown>> = {
  en: en as unknown as Record<string, Record<string, unknown>>,
  fr: fr as unknown as Record<string, Record<string, unknown>>,
};

/** Every `handle("literal")` in the file, for the handles we know the namespace of. */
function literalKeys(
  source: string,
  handles: Record<string, string>,
): { handle: string; namespace: string; key: string }[] {
  const found: { handle: string; namespace: string; key: string }[] = [];
  for (const [handle, namespace] of Object.entries(handles)) {
    // handle("some_key" — double quotes only, which is what prettier produces
    // here. A backtick key is dynamic and deliberately not matched.
    const re = new RegExp(`\\b${handle}\\("([a-z0-9_]+)"`, "g");
    for (const m of source.matchAll(re)) {
      found.push({ handle, namespace, key: m[1] });
    }
  }
  return found;
}

describe("every literal translation key on the task screens exists", () => {
  for (const file of FILES) {
    const source = readFileSync(join(process.cwd(), file.path), "utf8");
    const keys = literalKeys(source, file.namespaces);

    it(`${file.path} uses at least one key (the scan is actually working)`, () => {
      // Guards the guard: a rename that broke the regex would otherwise make
      // this whole file silently pass by finding nothing.
      expect(keys.length).toBeGreaterThan(0);
    });

    for (const { namespace, key } of keys) {
      for (const locale of ["en", "fr"] as const) {
        it(`${file.path}: ${locale} has ${namespace}.${key}`, () => {
          const ns = MESSAGES[locale][namespace] as
            | Record<string, unknown>
            | undefined;
          expect(ns, `${locale} has no namespace ${namespace}`).toBeTruthy();
          const value = ns?.[key];
          expect(
            typeof value,
            `${locale}: ${namespace}.${key} is missing — it would render as "${namespace}.${key}" on screen`,
          ).toBe("string");
          expect(value, `${locale}: ${namespace}.${key} is empty`).toBeTruthy();
        });
      }
    }
  }
});
