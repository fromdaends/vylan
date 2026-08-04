import { describe, it, expect } from "vitest";
import {
  readTaskTemplatePayload,
  isWorthSavingTaskTemplate,
  emptyTaskTemplatePayload,
} from "./template-payload";

describe("readTaskTemplatePayload — total, never throws", () => {
  it("survives null, undefined and a bare string", () => {
    expect(readTaskTemplatePayload(null).tasks).toEqual([]);
    expect(readTaskTemplatePayload(undefined).tasks).toEqual([]);
    expect(readTaskTemplatePayload("nonsense").tasks).toEqual([]);
  });

  it("survives an empty object — the column default", () => {
    expect(readTaskTemplatePayload({}).tasks).toEqual([]);
  });

  it("survives tasks being the wrong type entirely", () => {
    expect(readTaskTemplatePayload({ tasks: "not an array" }).tasks).toEqual([]);
    expect(readTaskTemplatePayload({ tasks: 42 }).tasks).toEqual([]);
  });

  it("ignores non-object entries inside the array", () => {
    const p = readTaskTemplatePayload({
      tasks: [null, "x", 7, { title: "Real" }],
    });
    expect(p.tasks).toEqual([{ title: "Real", kind: "task" }]);
  });

  it("keeps fields it does not know about from breaking the row", () => {
    const p = readTaskTemplatePayload({
      tasks: [{ title: "Review", kind: "review", durationDays: 3 }],
    });
    expect(p.tasks).toEqual([{ title: "Review", kind: "review" }]);
  });
});

describe("readTaskTemplatePayload — titles", () => {
  it("drops a task with no title", () => {
    expect(readTaskTemplatePayload({ tasks: [{ kind: "review" }] }).tasks).toEqual(
      [],
    );
  });

  it("drops a whitespace-only title rather than keeping a blank row", () => {
    expect(readTaskTemplatePayload({ tasks: [{ title: "   " }] }).tasks).toEqual(
      [],
    );
  });

  it("trims the titles it keeps", () => {
    const p = readTaskTemplatePayload({ tasks: [{ title: "  File it  " }] });
    expect(p.tasks[0].title).toBe("File it");
  });

  it("drops a non-string title", () => {
    expect(readTaskTemplatePayload({ tasks: [{ title: 12 }] }).tasks).toEqual([]);
  });
});

describe("readTaskTemplatePayload — kinds", () => {
  it("keeps a known kind", () => {
    const p = readTaskTemplatePayload({
      tasks: [{ title: "Docs", kind: "document_collection" }],
    });
    expect(p.tasks[0].kind).toBe("document_collection");
  });

  it("downgrades an unknown kind rather than losing the task", () => {
    const p = readTaskTemplatePayload({
      tasks: [{ title: "From a newer build", kind: "time_entry" }],
    });
    expect(p.tasks).toEqual([{ title: "From a newer build", kind: "task" }]);
  });

  it("defaults a missing kind to a plain task", () => {
    const p = readTaskTemplatePayload({ tasks: [{ title: "Something" }] });
    expect(p.tasks[0].kind).toBe("task");
  });

  it("does NOT store assignees even when the row carries them", () => {
    const p = readTaskTemplatePayload({
      tasks: [{ title: "Prepare", assigneeIds: ["a", "b"] }],
    });
    expect(p.tasks[0]).toEqual({ title: "Prepare", kind: "task" });
    expect(p.tasks[0]).not.toHaveProperty("assigneeIds");
  });
});

describe("isWorthSavingTaskTemplate", () => {
  it("refuses an empty template — a name attached to nothing", () => {
    expect(isWorthSavingTaskTemplate(emptyTaskTemplatePayload())).toBe(false);
  });

  it("accepts one with a task", () => {
    expect(
      isWorthSavingTaskTemplate({ tasks: [{ title: "A", kind: "task" }] }),
    ).toBe(true);
  });

  it("refuses a payload whose only rows were dropped as untitled", () => {
    const p = readTaskTemplatePayload({ tasks: [{ title: "" }, { title: " " }] });
    expect(isWorthSavingTaskTemplate(p)).toBe(false);
  });
});
