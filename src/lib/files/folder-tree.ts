// Folder-tree rules, as pure functions.
//
// A folder tree has exactly one way to corrupt itself catastrophically, and it
// is not data loss — it is a CYCLE. Drag "Reports" into its own sub-folder and
// the two folders become unreachable from the root, permanently invisible in
// the UI, while any code that walks ancestors to build a path loops until the
// stack blows. Nothing about that is recoverable from the interface that caused
// it.
//
// So the guard lives here, pure and tested, rather than inside a server action
// where it can only be checked by trying it.

export type FolderNode = {
  id: string;
  parentId: string | null;
  name: string;
};

/**
 * Would moving `folderId` under `newParentId` create a cycle?
 *
 * True when the proposed parent IS the folder, or is any of its descendants.
 * Also true if the existing tree is already broken (a pre-existing cycle would
 * otherwise make this walk hang) — the safe answer to "is this move dangerous"
 * when the structure makes no sense is yes.
 */
export function wouldCreateCycle(
  folders: FolderNode[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false; // moving to the root is always safe
  if (newParentId === folderId) return true;

  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let cursor: string | null = newParentId;

  // Walk UP from the proposed parent. If we reach the folder being moved, the
  // proposed parent is one of its descendants and the move would detach the
  // whole branch from the root.
  while (cursor) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return true; // already-broken tree; refuse
    seen.add(cursor);
    const node: FolderNode | undefined = byId.get(cursor);
    if (!node) return false; // parent outside this set — nothing to loop through
    cursor = node.parentId;
  }
  return false;
}

/**
 * The chain from the root down to this folder, for a path bar.
 *
 * Returns [] for an unknown id. Bails out on a cycle rather than looping —
 * wouldCreateCycle should make that impossible, but a path renderer is the
 * worst place to discover it was not.
 */
export function folderPath(
  folders: FolderNode[],
  folderId: string | null,
): FolderNode[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: FolderNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = folderId;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const node: FolderNode | undefined = byId.get(cursor);
    if (!node) break;
    out.unshift(node);
    cursor = node.parentId;
  }
  return out;
}

/** Direct children of a folder (or of the root when parentId is null). */
export function childrenOf(
  folders: FolderNode[],
  parentId: string | null,
): FolderNode[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every descendant of a folder, itself excluded.
 *
 * Used to stop the "move to…" picker offering a folder's own subtree as a
 * destination — the cycle guard would refuse it anyway, but offering a choice
 * that is always rejected is a worse interface than not offering it.
 */
export function descendantsOf(
  folders: FolderNode[],
  folderId: string,
): Set<string> {
  const out = new Set<string>();
  const byParent = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  const stack = [folderId];
  const guard = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (guard.has(id)) continue;
    guard.add(id);
    for (const child of byParent.get(id) ?? []) {
      out.add(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** Trim and collapse a typed folder name; "" means the caller should reject. */
export function normalizeFolderName(raw: string): string {
  return raw.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Is this name already taken by a live sibling?
 *
 * Case- and whitespace-insensitive, matching the database's unique indexes —
 * if these two disagree, the user gets an opaque constraint error instead of a
 * sentence telling them the name is taken.
 */
export function nameTaken(
  folders: FolderNode[],
  parentId: string | null,
  name: string,
  exceptId?: string,
): boolean {
  const want = normalizeFolderName(name).toLowerCase();
  return folders.some(
    (f) =>
      f.parentId === parentId &&
      f.id !== exceptId &&
      normalizeFolderName(f.name).toLowerCase() === want,
  );
}
