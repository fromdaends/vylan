import { describe, it, expect } from "vitest";
import {
  emptyTask,
  isMeaningful,
  meaningfulTasks,
  kindTaken,
  availableKinds,
  documentCollectionIndex,
  collectsDocuments,
  appendTemplateTasks,
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

describe("appendTemplateTasks", () => {
  it("appends plain rows unchanged and keeps their order", () => {
    const res = appendTemplateTasks(
      [task({ title: "Existing" })],
      [
        { title: "Kickoff", kind: "meeting" },
        { title: "File it", kind: "filing" },
      ],
    );
    expect(res.tasks.map((t) => t.title)).toEqual([
      "Existing",
      "Kickoff",
      "File it",
    ]);
    expect(res.tasks[1].kind).toBe("meeting");
    expect(res.downgraded).toEqual([]);
  });

  it("keeps a screen-backed kind when the engagement does not hold it yet", () => {
    const res = appendTemplateTasks(
      [task({ title: "Review", kind: "review" })],
      [{ title: "Collect documents", kind: "document_collection" }],
    );
    expect(res.tasks[1].kind).toBe("document_collection");
    expect(res.downgraded).toEqual([]);
  });

  it("DOWNGRADES rather than drops when the kind is already held", () => {
    const res = appendTemplateTasks(
      [task({ title: "Docs", kind: "document_collection" })],
      [{ title: "Collect documents", kind: "document_collection" }],
    );
    // The row survives — losing it would lose a step the firm wrote down.
    expect(res.tasks).toHaveLength(2);
    expect(res.tasks[1].title).toBe("Collect documents");
    expect(res.tasks[1].kind).toBe("task");
    expect(res.downgraded).toEqual(["Collect documents"]);
  });

  it("handles a template that clashes with ITSELF", () => {
    // Checked against the accumulating list, not just the existing one.
    const res = appendTemplateTasks(
      [],
      [
        { title: "First ask", kind: "document_collection" },
        { title: "Second ask", kind: "document_collection" },
      ],
    );
    expect(res.tasks[0].kind).toBe("document_collection");
    expect(res.tasks[1].kind).toBe("task");
    expect(res.downgraded).toEqual(["Second ask"]);
  });

  it("never downgrades a screenless kind — six meetings is fine", () => {
    const res = appendTemplateTasks(
      [task({ title: "Kickoff", kind: "meeting" })],
      [
        { title: "Mid-point", kind: "meeting" },
        { title: "Wrap-up", kind: "meeting" },
      ],
    );
    expect(res.tasks.every((t) => t.kind === "meeting")).toBe(true);
    expect(res.downgraded).toEqual([]);
  });

  it("trims incoming titles and skips blank ones", () => {
    const res = appendTemplateTasks(
      [],
      [
        { title: "  Padded  ", kind: "task" },
        { title: "   ", kind: "task" },
      ],
    );
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0].title).toBe("Padded");
  });

  it("appends with nobody assigned — a template is a shape of work, not a roster", () => {
    const res = appendTemplateTasks([], [{ title: "Prepare", kind: "task" }]);
    expect(res.tasks[0].assigneeIds).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const existing = [task({ title: "Existing" })];
    appendTemplateTasks(existing, [{ title: "New", kind: "task" }]);
    expect(existing).toHaveLength(1);
  });

  it("applying an empty template changes nothing", () => {
    const existing = [task({ title: "Existing" })];
    const res = appendTemplateTasks(existing, []);
    expect(res.tasks).toEqual(existing);
    expect(res.downgraded).toEqual([]);
  });
});
