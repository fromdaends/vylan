import { describe, it, expect } from "vitest";
import {
  readTaskTemplatePayload,
  isWorthSavingTaskTemplate,
  emptyTaskTemplatePayload,
} from "./template-payload";

const req = (over: Record<string, unknown> = {}) => ({
  label_en: "T4",
  label_fr: "T4",
  ...over,
});

describe("readTaskTemplatePayload — total, never throws", () => {
  it("survives null, undefined and a bare string", () => {
    expect(readTaskTemplatePayload(null)).toEqual(emptyTaskTemplatePayload());
    expect(readTaskTemplatePayload(undefined)).toEqual(
      emptyTaskTemplatePayload(),
    );
    expect(readTaskTemplatePayload("nonsense")).toEqual(
      emptyTaskTemplatePayload(),
    );
  });

  it("survives an empty object — the column default", () => {
    expect(readTaskTemplatePayload({})).toEqual(emptyTaskTemplatePayload());
  });

  it("survives subtasks being the wrong type entirely", () => {
    expect(readTaskTemplatePayload({ subtasks: "nope" }).subtasks).toEqual([]);
    expect(readTaskTemplatePayload({ subtasks: 42 }).subtasks).toEqual([]);
  });

  it("ignores fields it does not know about", () => {
    const p = readTaskTemplatePayload({
      kind: "review",
      subtasks: [{ title: "Step", budgetedHours: 3 }],
    });
    expect(p.subtasks).toEqual([{ title: "Step" }]);
  });
});

describe("the parent task", () => {
  it("keeps a known kind", () => {
    expect(readTaskTemplatePayload({ kind: "bookkeeping" }).kind).toBe(
      "bookkeeping",
    );
  });

  it("downgrades an unknown kind rather than failing the whole template", () => {
    expect(readTaskTemplatePayload({ kind: "time_entry" }).kind).toBe("task");
  });

  it("defaults a missing kind to a plain task", () => {
    expect(readTaskTemplatePayload({ subtasks: [] }).kind).toBe("task");
  });

  it("trims the internal description", () => {
    expect(readTaskTemplatePayload({ description: "  note  " }).description).toBe(
      "note",
    );
  });

  it("treats a non-string description as absent", () => {
    expect(readTaskTemplatePayload({ description: 7 }).description).toBe("");
  });
});

describe("subtasks", () => {
  it("keeps them in order", () => {
    const p = readTaskTemplatePayload({
      subtasks: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
    });
    expect(p.subtasks.map((s) => s.title)).toEqual(["One", "Two", "Three"]);
  });

  it("drops an untitled step rather than keeping a blank row", () => {
    const p = readTaskTemplatePayload({
      subtasks: [{ title: "" }, { title: "   " }, { title: "Real" }],
    });
    expect(p.subtasks).toEqual([{ title: "Real" }]);
  });

  it("trims the titles it keeps", () => {
    expect(
      readTaskTemplatePayload({ subtasks: [{ title: "  Reconcile  " }] })
        .subtasks[0].title,
    ).toBe("Reconcile");
  });

  it("accepts a bare string as a step", () => {
    const p = readTaskTemplatePayload({ subtasks: ["Reconcile", "  ", "Post"] });
    expect(p.subtasks).toEqual([{ title: "Reconcile" }, { title: "Post" }]);
  });

  it("ignores non-object, non-string entries", () => {
    const p = readTaskTemplatePayload({
      subtasks: [null, 7, { title: "Real" }],
    });
    expect(p.subtasks).toEqual([{ title: "Real" }]);
  });
});

describe("the client request the parent carries", () => {
  it("keeps it", () => {
    const p = readTaskTemplatePayload({ checklist: [req()] });
    expect(p.checklist).toHaveLength(1);
    expect(p.checklist[0].label_en).toBe("T4");
  });

  it("is an empty list when absent", () => {
    expect(readTaskTemplatePayload({ subtasks: [] }).checklist).toEqual([]);
  });

  it("survives a checklist that is not an array", () => {
    expect(readTaskTemplatePayload({ checklist: "nope" }).checklist).toEqual([]);
  });

  it("drops a line with no label in either language", () => {
    const p = readTaskTemplatePayload({
      checklist: [{ label_en: "", label_fr: "  " }, req()],
    });
    expect(p.checklist).toHaveLength(1);
  });

  it("mirrors one language into the other when only one is given", () => {
    const p = readTaskTemplatePayload({
      checklist: [{ label_fr: "Relevé T4" }],
    });
    expect(p.checklist[0].label_en).toBe("Relevé T4");
    expect(p.checklist[0].label_fr).toBe("Relevé T4");
  });

  it('does NOT treat the string "true" as required', () => {
    const p = readTaskTemplatePayload({
      checklist: [req({ required: "true" })],
    });
    expect(p.checklist[0].required).toBe(false);
  });

  it("keeps required when it is really true", () => {
    const p = readTaskTemplatePayload({ checklist: [req({ required: true })] });
    expect(p.checklist[0].required).toBe(true);
  });

  it("nulls an empty description and doc_type rather than storing blanks", () => {
    const p = readTaskTemplatePayload({
      checklist: [req({ description_en: "", doc_type: "" })],
    });
    expect(p.checklist[0].description_en).toBeNull();
    expect(p.checklist[0].doc_type).toBeNull();
  });
});

describe("upgrading the OLD flat shape", () => {
  it("turns the flat list into the parent's subtasks, in order", () => {
    const p = readTaskTemplatePayload({
      tasks: [{ title: "Reconcile" }, { title: "Review" }, { title: "Post" }],
    });
    expect(p.subtasks.map((s) => s.title)).toEqual([
      "Reconcile",
      "Review",
      "Post",
    ]);
  });

  it("lifts the first meaningful kind onto the parent", () => {
    const p = readTaskTemplatePayload({
      tasks: [
        { title: "Prep", kind: "task" },
        { title: "Collect", kind: "document_collection" },
      ],
    });
    expect(p.kind).toBe("document_collection");
  });

  it("falls back to a plain task when the flat list named no kind", () => {
    const p = readTaskTemplatePayload({ tasks: [{ title: "Prep" }] });
    expect(p.kind).toBe("task");
  });

  it("lifts the first client request onto the parent", () => {
    const p = readTaskTemplatePayload({
      tasks: [
        { title: "Prep" },
        { title: "Collect", kind: "document_collection", checklist: [req()] },
      ],
    });
    expect(p.checklist).toHaveLength(1);
    expect(p.checklist[0].label_en).toBe("T4");
  });

  it("loses no WORK — every titled row survives as a step", () => {
    const p = readTaskTemplatePayload({
      tasks: [
        { title: "A", kind: "document_collection" },
        { title: "B", kind: "signatures" },
        { title: "C", kind: "review" },
      ],
    });
    expect(p.subtasks).toHaveLength(3);
  });

  it("drops untitled legacy rows", () => {
    const p = readTaskTemplatePayload({
      tasks: [{ title: "" }, { title: "Real" }],
    });
    expect(p.subtasks).toEqual([{ title: "Real" }]);
  });

  it("prefers the CURRENT shape when a payload somehow carries both", () => {
    const p = readTaskTemplatePayload({
      tasks: [{ title: "old" }],
      subtasks: [{ title: "new" }],
    });
    expect(p.subtasks).toEqual([{ title: "new" }]);
  });

  it("reads an empty legacy list as an empty template", () => {
    const p = readTaskTemplatePayload({ tasks: [] });
    expect(p.subtasks).toEqual([]);
    expect(isWorthSavingTaskTemplate(p)).toBe(false);
  });
});

describe("isWorthSavingTaskTemplate", () => {
  it("refuses one with no steps and nothing asked of the client", () => {
    expect(isWorthSavingTaskTemplate(emptyTaskTemplatePayload())).toBe(false);
  });

  it("accepts one with a step", () => {
    expect(
      isWorthSavingTaskTemplate({
        ...emptyTaskTemplatePayload(),
        subtasks: [{ title: "A" }],
      }),
    ).toBe(true);
  });

  it("accepts a pure document ask, with no steps at all", () => {
    expect(
      isWorthSavingTaskTemplate({
        ...emptyTaskTemplatePayload(),
        kind: "document_collection",
        checklist: [
          {
            label_en: "T4",
            label_fr: "T4",
            description_en: null,
            description_fr: null,
            doc_type: null,
            required: true,
          },
        ],
      }),
    ).toBe(true);
  });

  it("refuses a payload whose only rows were dropped as untitled", () => {
    const p = readTaskTemplatePayload({ subtasks: [{ title: "" }] });
    expect(isWorthSavingTaskTemplate(p)).toBe(false);
  });
});
