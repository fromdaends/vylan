import { describe, it, expect } from "vitest";
import {
  emptyTask,
  isMeaningful,
  meaningfulTasks,
  kindTaken,
  availableKinds,
  documentCollectionIndex,
  collectsDocuments,
  appendTaskTemplate,
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

describe("appendTaskTemplate — one template adds ONE task", () => {
  const tpl = (over: Record<string, unknown> = {}) => ({
    name: "Month-end close",
    kind: "bookkeeping" as const,
    subtasks: [{ title: "Reconcile" }, { title: "Post journals" }],
    ...over,
  });

  it("adds a single parent, not one row per step", () => {
    const res = appendTaskTemplate([], tpl());
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0].title).toBe("Month-end close");
  });

  it("hangs the steps under it, in order", () => {
    const res = appendTaskTemplate([], tpl());
    expect(res.tasks[0].subtasks).toEqual([
      { title: "Reconcile" },
      { title: "Post journals" },
    ]);
  });

  it("keeps the template's kind when the engagement does not hold it", () => {
    const res = appendTaskTemplate([], tpl({ kind: "document_collection" }));
    expect(res.tasks[0].kind).toBe("document_collection");
    expect(res.downgraded).toEqual([]);
  });

  it("DOWNGRADES rather than drops when the kind is already held", () => {
    const existing = [task({ title: "Docs", kind: "document_collection" })];
    const res = appendTaskTemplate(
      existing,
      tpl({ kind: "document_collection" }),
    );
    // The whole template survives, steps intact — only its screen is lost.
    expect(res.tasks).toHaveLength(2);
    expect(res.tasks[1].kind).toBe("task");
    expect(res.tasks[1].subtasks).toHaveLength(2);
    expect(res.downgraded).toEqual(["Month-end close"]);
  });

  it("never downgrades a screenless kind — six meetings is fine", () => {
    const existing = [task({ title: "Kickoff", kind: "meeting" })];
    const res = appendTaskTemplate(existing, tpl({ kind: "meeting" }));
    expect(res.tasks[1].kind).toBe("meeting");
    expect(res.downgraded).toEqual([]);
  });

  it("appends after what is already there", () => {
    const existing = [task({ title: "Existing" })];
    const res = appendTaskTemplate(existing, tpl());
    expect(res.tasks.map((t) => t.title)).toEqual([
      "Existing",
      "Month-end close",
    ]);
  });

  it("trims step titles and drops blank ones", () => {
    const res = appendTaskTemplate(
      [],
      tpl({ subtasks: [{ title: "  Padded  " }, { title: "   " }] }),
    );
    expect(res.tasks[0].subtasks).toEqual([{ title: "Padded" }]);
  });

  it("omits subtasks entirely when the template has none", () => {
    const res = appendTaskTemplate([], tpl({ subtasks: [] }));
    expect(res.tasks[0]).not.toHaveProperty("subtasks");
  });

  it("adds nothing for a nameless template rather than a blank row", () => {
    const existing = [task({ title: "Existing" })];
    const res = appendTaskTemplate(existing, tpl({ name: "   " }));
    expect(res.tasks).toHaveLength(1);
    expect(res.downgraded).toEqual([]);
  });

  it("arrives with nobody assigned — a template is a shape, not a roster", () => {
    const res = appendTaskTemplate([], tpl());
    expect(res.tasks[0].assigneeIds).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const existing = [task({ title: "Existing" })];
    appendTaskTemplate(existing, tpl());
    expect(existing).toHaveLength(1);
  });
});

describe("meaningfulTasks — subtasks", () => {
  it("trims steps and drops untitled ones", () => {
    const out = meaningfulTasks([
      task({
        title: "Parent",
        subtasks: [{ title: "  Step  " }, { title: "  " }],
      }),
    ]);
    expect(out[0].subtasks).toEqual([{ title: "Step" }]);
  });

  it("omits the key when every step was blank", () => {
    const out = meaningfulTasks([
      task({ title: "Parent", subtasks: [{ title: "  " }] }),
    ]);
    expect(out[0]).not.toHaveProperty("subtasks");
  });

  it("leaves a task with no steps alone", () => {
    const out = meaningfulTasks([task({ title: "Parent" })]);
    expect(out[0]).not.toHaveProperty("subtasks");
  });
});

describe("appendTaskTemplate — where a task came from", () => {
  const tpl = {
    name: "Month-end close",
    kind: "bookkeeping" as const,
    subtasks: [{ title: "Reconcile" }],
  };

  it("records the service that pulled it in", () => {
    const res = appendTaskTemplate([], tpl, "Monthly Bookkeeping");
    expect(res.tasks[0].sourceLabel).toBe("Monthly Bookkeeping");
  });

  it("omits the label entirely when a person added it by hand", () => {
    const res = appendTaskTemplate([], tpl);
    expect(res.tasks[0]).not.toHaveProperty("sourceLabel");
  });

  it("keeps the label on a DOWNGRADED task — you still need to know why it is there", () => {
    const existing = [task({ title: "Docs", kind: "document_collection" })];
    const res = appendTaskTemplate(
      existing,
      { ...tpl, kind: "document_collection" },
      "Year-end",
    );
    expect(res.tasks[1].kind).toBe("task");
    expect(res.tasks[1].sourceLabel).toBe("Year-end");
  });

  it("does not leak the label into what gets SAVED", () => {
    // It explains the row on screen; engagement_tasks has no column for it.
    const res = appendTaskTemplate([], tpl, "Monthly Bookkeeping");
    const saved = meaningfulTasks(res.tasks);
    expect(saved[0]).not.toHaveProperty("sourceLabel");
  });
});
