import { describe, expect, it } from "vitest";
import {
  childrenOf,
  descendantsOf,
  folderPath,
  nameTaken,
  normalizeFolderName,
  wouldCreateCycle,
  type FolderNode,
} from "./folder-tree";

// A small tree, used throughout:
//   Reports
//     2023
//       Q1
//   Correspondence
const tree: FolderNode[] = [
  { id: "reports", parentId: null, name: "Reports" },
  { id: "y2023", parentId: "reports", name: "2023" },
  { id: "q1", parentId: "y2023", name: "Q1" },
  { id: "corr", parentId: null, name: "Correspondence" },
];

describe("wouldCreateCycle", () => {
  it("refuses to put a folder inside itself", () => {
    expect(wouldCreateCycle(tree, "reports", "reports")).toBe(true);
  });

  it("refuses to put a folder inside its own child", () => {
    // The one that actually loses data in practice: drag Reports into 2023 and
    // both vanish from the root, permanently.
    expect(wouldCreateCycle(tree, "reports", "y2023")).toBe(true);
  });

  it("refuses to put a folder inside a deeper descendant", () => {
    expect(wouldCreateCycle(tree, "reports", "q1")).toBe(true);
  });

  it("allows a move to an unrelated branch", () => {
    expect(wouldCreateCycle(tree, "q1", "corr")).toBe(false);
    expect(wouldCreateCycle(tree, "y2023", "corr")).toBe(false);
  });

  it("allows a move to the root", () => {
    expect(wouldCreateCycle(tree, "q1", null)).toBe(false);
  });

  it("allows moving a parent under an unrelated folder", () => {
    expect(wouldCreateCycle(tree, "corr", "q1")).toBe(false);
  });

  it("refuses rather than hangs on an already-broken tree", () => {
    // Two folders each claiming the other as parent. Walking up loops forever
    // unless the walk guards itself — and a hang here is a dead server thread.
    const broken: FolderNode[] = [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ];
    expect(wouldCreateCycle(broken, "a", "b")).toBe(true);
  });
});

describe("folderPath", () => {
  it("builds the chain from the root down", () => {
    expect(folderPath(tree, "q1").map((f) => f.name)).toEqual([
      "Reports",
      "2023",
      "Q1",
    ]);
  });

  it("returns just the folder for a root-level one", () => {
    expect(folderPath(tree, "corr").map((f) => f.name)).toEqual(["Correspondence"]);
  });

  it("returns nothing for null or an unknown id", () => {
    expect(folderPath(tree, null)).toEqual([]);
    expect(folderPath(tree, "nope")).toEqual([]);
  });

  it("bails out instead of looping on a broken tree", () => {
    const broken: FolderNode[] = [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ];
    expect(folderPath(broken, "a").length).toBeLessThanOrEqual(2);
  });
});

describe("childrenOf", () => {
  it("lists root folders alphabetically", () => {
    expect(childrenOf(tree, null).map((f) => f.name)).toEqual([
      "Correspondence",
      "Reports",
    ]);
  });

  it("lists a folder's direct children only", () => {
    expect(childrenOf(tree, "reports").map((f) => f.name)).toEqual(["2023"]);
  });

  it("returns nothing for a leaf", () => {
    expect(childrenOf(tree, "q1")).toEqual([]);
  });
});

describe("descendantsOf", () => {
  it("collects the whole subtree, excluding the folder itself", () => {
    expect(descendantsOf(tree, "reports")).toEqual(new Set(["y2023", "q1"]));
  });

  it("is empty for a leaf", () => {
    expect(descendantsOf(tree, "q1").size).toBe(0);
  });

  it("terminates on a broken tree", () => {
    const broken: FolderNode[] = [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ];
    expect(descendantsOf(broken, "a").size).toBeLessThanOrEqual(2);
  });
});

describe("normalizeFolderName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeFolderName("  Tax   Returns  ")).toBe("Tax Returns");
    expect(normalizeFolderName("Line\nbreak")).toBe("Line break");
  });

  it("caps the length to match the database check", () => {
    expect(normalizeFolderName("x".repeat(300))).toHaveLength(120);
  });

  it("returns empty for whitespace-only input", () => {
    expect(normalizeFolderName("   ")).toBe("");
  });
});

describe("nameTaken", () => {
  it("matches the database's case- and space-insensitive uniqueness", () => {
    // If this disagreed with the unique index, the user would get an opaque
    // constraint error instead of "that name is already used".
    expect(nameTaken(tree, null, "reports")).toBe(true);
    expect(nameTaken(tree, null, "  REPORTS ")).toBe(true);
  });

  it("only collides within the same parent", () => {
    // "2023" under Reports must not block "2023" under Correspondence.
    expect(nameTaken(tree, "corr", "2023")).toBe(false);
    expect(nameTaken(tree, "reports", "2023")).toBe(true);
  });

  it("ignores the folder being renamed", () => {
    // Renaming "Reports" to "Reports" is a no-op, not a collision.
    expect(nameTaken(tree, null, "Reports", "reports")).toBe(false);
  });

  it("allows a genuinely new name", () => {
    expect(nameTaken(tree, null, "Payroll")).toBe(false);
  });
});
