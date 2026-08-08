import { describe, it, expect, vi, beforeEach } from "vitest";

// DELETING A FOLDER MARKS IT GONE **BEFORE** PROMOTING ITS CHILDREN.
//
// The founder, on a "2026" folder that would not delete: "for some reason i
// can't delete this file, is this a bug?" It was. Deleting a folder promotes
// its sub-folders one level up, and a child sharing the parent's name — "2026"
// inside "2026", exactly what year-filing produces — landed beside a parent
// that was still live. document_folders_unique_root rejected it with 23505,
// the action returned "That didn't work. Try again.", and no amount of
// retrying could ever succeed.
//
// Both unique indexes are PARTIAL (`where deleted_at is null`), so a
// soft-deleted parent stops occupying the name. Order is therefore the whole
// fix, and order is what this test pins.

const calls: string[] = [];

function tableStub(table: string, viaServiceRole: boolean) {
  return {
    update(patch: Record<string, unknown>) {
      const chain = {
        eq(col: string) {
          if (
            table === "document_folders" &&
            "deleted_at" in patch &&
            col === "id"
          ) {
            calls.push("soft-delete");
          }
          if (
            table === "document_folders" &&
            "parent_id" in patch &&
            col === "parent_id"
          ) {
            calls.push("reparent-subfolders");
          }
          return { ...chain, then: undefined, error: null, eq: chain.eq };
        },
        then(resolve: (v: { error: null; data: unknown[] }) => unknown) {
          return Promise.resolve({ error: null, data: [] }).then(resolve);
        },
      };
      void viaServiceRole;
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    from: (t: string) => tableStub(t, false),
  }),
  getServiceRoleSupabase: () => ({
    from: (t: string) => tableStub(t, true),
  }),
}));
vi.mock("@/lib/db/firms", () => ({
  getCurrentFirm: async () => ({ id: "firm-1" }),
}));
vi.mock("@/lib/db/users", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/db/activity", () => ({ logUserActivity: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/db/folders", () => ({
  listClientFolders: async () => ({
    folders: [
      { id: "parent-2026", clientId: "c1", parentId: null, name: "2026" },
      // The child that shares its parent's name — the shape that broke.
      { id: "child-2026", clientId: "c1", parentId: "parent-2026", name: "2026" },
    ],
    available: true,
  }),
}));

const { deleteFolderAction } = await import("./folders");

beforeEach(() => {
  calls.length = 0;
});

describe("deleteFolderAction ordering", () => {
  it("soft-deletes the folder BEFORE promoting its sub-folders", async () => {
    const res = await deleteFolderAction({
      clientId: "c1",
      folderId: "parent-2026",
    });
    expect(res.ok).toBe(true);

    const del = calls.indexOf("soft-delete");
    const reparent = calls.indexOf("reparent-subfolders");
    expect(del).toBeGreaterThanOrEqual(0);
    expect(reparent).toBeGreaterThanOrEqual(0);
    // The whole fix: the name is freed before a same-named child takes it.
    expect(del).toBeLessThan(reparent);
  });
});
