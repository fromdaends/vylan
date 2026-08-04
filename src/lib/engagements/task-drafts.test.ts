import { describe, it, expect } from "vitest";
import {
  emptyTask,
  isMeaningful,
  meaningfulTasks,
  kindTaken,
  availableKinds,
  documentCollectionIndex,
  collectsDocuments,
  type TaskDraft,
} from "./task-drafts";

const task = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  ...emptyTask(),
  ...over,
});

describe("isMeaningful", () => {
  it("is false for a blank row", () => {
    expect(isMeaningful(emptyTask())).toBe(false);
  });

  it("does not count whitespace as a name", () => {
    expect(isMeaningful(task({ title: "   " }))).toBe(false);
  });

  it("is true once it has a title", () => {
    expect(isMeaningful(task({ title: "Collect documents" }))).toBe(true);
  });

  it("ignores kind — an untitled row is untitled whatever it is FOR", () => {
    expect(isMeaningful(task({ kind: "document_collection" }))).toBe(false);
  });
});

describe("meaningfulTasks", () => {
  it("drops blank rows and keeps order", () => {
    const out = meaningfulTasks([
      task({ title: "First" }),
      task({ title: "  " }),
      task({ title: "Second" }),
    ]);
    expect(out.map((x) => x.title)).toEqual(["First", "Second"]);
  });

  it("trims the titles it keeps", () => {
    expect(meaningfulTasks([task({ title: "  Review  " })])[0].title).toBe(
      "Review",
    );
  });

  it("puts each assignee on the row once", () => {
    const out = meaningfulTasks([
      task({ title: "Review", assigneeIds: ["a", "b", "a"] }),
    ]);
    expect(out[0].assigneeIds).toEqual(["a", "b"]);
  });

  it("returns nothing when every row is blank", () => {
    expect(meaningfulTasks([emptyTask(), emptyTask()])).toEqual([]);
  });
});

describe("kindTaken — 1370's one-per-engagement index", () => {
  it("is true for a second screen-backed kind", () => {
    const tasks = [task({ title: "Docs", kind: "document_collection" })];
    expect(kindTaken(tasks, "document_collection")).toBe(true);
  });

  it("is FALSE for a kind with no screen — six meetings is fine", () => {
    const tasks = [
      task({ title: "Kickoff", kind: "meeting" }),
      task({ title: "Review call", kind: "meeting" }),
    ];
    expect(kindTaken(tasks, "meeting")).toBe(false);
  });

  it("does not let a row conflict with itself", () => {
    const tasks = [task({ title: "Docs", kind: "document_collection" })];
    expect(kindTaken(tasks, "document_collection", 0)).toBe(false);
  });

  it("is false when nothing holds the kind yet", () => {
    expect(kindTaken([task({ title: "A" })], "signatures")).toBe(false);
  });
});

describe("availableKinds", () => {
  it("hides a screen-backed kind another row already holds", () => {
    const tasks = [
      task({ title: "Docs", kind: "document_collection" }),
      task({ title: "Other", kind: "task" }),
    ];
    expect(availableKinds(tasks, 1)).not.toContain("document_collection");
  });

  it("still offers the row its OWN kind — a dropdown must never render blank", () => {
    const tasks = [
      task({ title: "Docs", kind: "document_collection" }),
      task({ title: "Also docs", kind: "document_collection" }),
    ];
    expect(availableKinds(tasks, 1)).toContain("document_collection");
  });

  it("keeps every screenless kind available to everyone", () => {
    const tasks = [
      task({ title: "A", kind: "meeting" }),
      task({ title: "B", kind: "task" }),
    ];
    expect(availableKinds(tasks, 1)).toContain("meeting");
  });

  it("offers every kind when the list is fresh", () => {
    expect(availableKinds([emptyTask()], 0)).toContain("document_collection");
    expect(availableKinds([emptyTask()], 0)).toContain("signatures");
  });
});

describe("documentCollectionIndex / collectsDocuments", () => {
  it("finds the row holding the checklist", () => {
    const tasks = [
      task({ title: "Kickoff", kind: "meeting" }),
      task({ title: "Docs", kind: "document_collection" }),
    ];
    expect(documentCollectionIndex(tasks)).toBe(1);
    expect(collectsDocuments(tasks)).toBe(true);
  });

  it("-1 is an ordinary answer — plenty of work asks the client for nothing", () => {
    const tasks = [task({ title: "File it", kind: "filing" })];
    expect(documentCollectionIndex(tasks)).toBe(-1);
    expect(collectsDocuments(tasks)).toBe(false);
  });
});
