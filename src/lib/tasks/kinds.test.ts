import { describe, it, expect } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { TASK_KINDS, KINDS_WITH_SCREENS } from "@/lib/db/engagement-tasks";
import {
  TASK_KIND_META,
  taskKindHasScreen,
  taskKindLabelKey,
  taskKindHintKey,
  taskKindMeta,
} from "./kinds";

// A wrong next-intl key renders as "Engagements.kind_notice" ON SCREEN and
// passes tsc, eslint and the build without a word. This is the guard my own
// notes say to write every time a keyed enum grows — it has cost this repo a
// visible bug twice.
describe("every task kind has its copy, in both languages", () => {
  for (const kind of TASK_KINDS) {
    it(`${kind} has a label and a hint in en and fr`, () => {
      for (const [locale, messages] of [
        ["en", en],
        ["fr", fr],
      ] as const) {
        // Not Record<string, string>: the namespace holds a nested `errors`
        // object too, so an honest read is `unknown` plus a type check at the
        // point of use.
        const ns: Record<string, unknown> = messages.Engagements;
        for (const key of [taskKindLabelKey(kind), taskKindHintKey(kind)]) {
          const value = ns[key];
          expect(typeof value, `${locale}: ${key} is missing`).toBe("string");
          expect(value, `${locale}: ${key} is empty`).toBeTruthy();
        }
      }
    });
  }
});

describe("the kind list and its metadata cannot drift apart", () => {
  it("describes every kind exactly once, and nothing that is not a kind", () => {
    expect(TASK_KIND_META.map((m) => m.kind).sort()).toEqual(
      [...TASK_KINDS].sort(),
    );
    expect(new Set(TASK_KIND_META.map((m) => m.kind)).size).toBe(
      TASK_KIND_META.length,
    );
  });

  // hasScreen decides two things at once: whether the UI makes the row
  // clickable, and which kinds 1370's partial unique index keeps to one per
  // job. If these two lists ever disagree, a kind either leads somewhere blank
  // or silently loses its uniqueness.
  it("agrees with KINDS_WITH_SCREENS about which kinds own a screen", () => {
    expect(TASK_KIND_META.filter((m) => m.hasScreen).map((m) => m.kind).sort()).toEqual(
      [...KINDS_WITH_SCREENS].sort(),
    );
  });

  it("keeps the three structural kinds, and only those three", () => {
    expect([...KINDS_WITH_SCREENS].sort()).toEqual([
      "deliverables",
      "document_collection",
      "signatures",
    ]);
    for (const kind of ["tax_return", "bookkeeping", "notice", "review", "meeting", "filing", "task"]) {
      expect(taskKindHasScreen(kind), kind).toBe(false);
    }
  });

  it("puts Other last — it is the fallback, not a competitor at the top", () => {
    expect(TASK_KIND_META.at(-1)?.kind).toBe("task");
  });

  it("returns null for a kind it does not know, rather than throwing", () => {
    // A row written by a newer build must still render in an older one.
    expect(taskKindMeta("questionnaire")).toBeNull();
    expect(taskKindHasScreen("questionnaire")).toBe(false);
  });
});
