"use server";

// Creating, renaming, moving and deleting a client's custom folders.
//
// Same three rules as the document actions: authorize through RLS (no
// hand-rolled permission check to drift), audit after the write lands, and
// never touch the stored file itself.
//
// DELETING A FOLDER NEVER DELETES DOCUMENTS. Its contents — documents and
// sub-folders alike — move up to its parent first, then the folder row is
// soft-deleted. That is why folders need no recycle bin of their own: nothing
// is ever lost by removing one, so there is nothing to restore. The alternative
// (refusing to delete a non-empty folder) makes tidying up a chore, and
// cascading the delete to documents would make a folder button destroy files.

import { revalidatePath } from "next/cache";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { logUserActivity } from "@/lib/db/activity";
import { listClientFolders } from "@/lib/db/folders";
import {
  nameTaken,
  normalizeFolderName,
  wouldCreateCycle,
} from "@/lib/files/folder-tree";

export type FolderActionResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      error: "invalid" | "name_taken" | "cycle" | "not_found" | "unavailable" | "error";
    };

const DOC_TABLES = ["uploaded_files", "final_documents", "imported_documents"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The outcome of moving documents.
 *
 * `skipped` is the one that matters: documents that were ALREADY where they
 * were being dropped. Counting those as moved is what let the UI report
 * "14 files moved" over a screen where nothing changed.
 */
export type MoveResult = {
  ok: boolean;
  succeeded: number;
  failed: number;
  skipped: number;
};

function isSchemaMissing(err: { code?: string | null } | null): boolean {
  return (
    err?.code === "PGRST204" ||
    err?.code === "42703" ||
    err?.code === "PGRST205" ||
    err?.code === "42P01"
  );
}

export async function createFolderAction(input: {
  clientId: string;
  parentId: string | null;
  name: string;
}): Promise<FolderActionResult> {
  const name = normalizeFolderName(input.name ?? "");
  if (!input.clientId || !name) return { ok: false, error: "invalid" };

  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };
  const sb = await getServerSupabase();

  // The client read is the permission check: RLS hides a client this user may
  // not see, so a folder can never be created under one.
  const { data: client } = await sb
    .from("clients")
    .select("id")
    .eq("id", input.clientId)
    .maybeSingle();
  if (!client) return { ok: false, error: "not_found" };

  // Checked here so the user gets a sentence rather than a raw unique-index
  // violation. The database index is still the real guarantee against two
  // people creating the same folder at the same moment.
  const { folders } = await listClientFolders(input.clientId);
  if (nameTaken(folders, input.parentId ?? null, name)) {
    return { ok: false, error: "name_taken" };
  }

  const { data: auth } = await sb.auth.getUser();
  const { data, error } = await sb
    .from("document_folders")
    .insert({
      firm_id: firm.id,
      client_id: input.clientId,
      parent_id: input.parentId ?? null,
      name,
      created_by: auth.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "name_taken" };
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }

  await logUserActivity(firm.id, null, "folder_created", {
    client_id: input.clientId,
    folder_id: data.id,
    name,
  });
  revalidatePath("/files");
  return { ok: true, id: data.id as string };
}

export async function renameFolderAction(input: {
  clientId: string;
  folderId: string;
  name: string;
}): Promise<FolderActionResult> {
  const name = normalizeFolderName(input.name ?? "");
  if (!input.folderId || !name) return { ok: false, error: "invalid" };

  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };

  const { folders } = await listClientFolders(input.clientId);
  const self = folders.find((f) => f.id === input.folderId);
  if (!self) return { ok: false, error: "not_found" };
  if (nameTaken(folders, self.parentId, name, self.id)) {
    return { ok: false, error: "name_taken" };
  }

  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("document_folders")
    .update({ name })
    .eq("id", input.folderId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "name_taken" };
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }
  if (!data) return { ok: false, error: "not_found" };

  await logUserActivity(firm.id, null, "folder_renamed", {
    client_id: input.clientId,
    folder_id: input.folderId,
    name,
  });
  revalidatePath("/files");
  return { ok: true };
}

/** Move a folder (and everything under it) to a different parent. */
export async function moveFolderAction(input: {
  clientId: string;
  folderId: string;
  newParentId: string | null;
}): Promise<FolderActionResult> {
  if (!input.folderId) return { ok: false, error: "invalid" };
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };

  const { folders } = await listClientFolders(input.clientId);
  const self = folders.find((f) => f.id === input.folderId);
  if (!self) return { ok: false, error: "not_found" };

  // THE guard. Dropping a folder into its own descendant detaches that whole
  // branch from the root: it becomes invisible in the UI and every ancestor
  // walk loops forever. Nothing about that is recoverable from the interface
  // that caused it, so it is refused before the write.
  if (wouldCreateCycle(folders, input.folderId, input.newParentId ?? null)) {
    return { ok: false, error: "cycle" };
  }
  if (nameTaken(folders, input.newParentId ?? null, self.name, self.id)) {
    return { ok: false, error: "name_taken" };
  }

  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("document_folders")
    .update({ parent_id: input.newParentId ?? null })
    .eq("id", input.folderId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "name_taken" };
    return { ok: false, error: isSchemaMissing(error) ? "unavailable" : "error" };
  }
  if (!data) return { ok: false, error: "not_found" };

  await logUserActivity(firm.id, null, "folder_moved", {
    client_id: input.clientId,
    folder_id: input.folderId,
    parent_id: input.newParentId ?? null,
  });
  revalidatePath("/files");
  return { ok: true };
}

/**
 * Remove a folder, keeping everything that was inside it.
 *
 * Contents are re-parented UP one level first — documents to the folder's
 * parent (or back to the derived year/category view if it was at the root),
 * sub-folders likewise. Only then is the folder row soft-deleted. A folder
 * button must never be a way to destroy documents.
 */
export async function deleteFolderAction(input: {
  clientId: string;
  folderId: string;
}): Promise<FolderActionResult> {
  if (!input.folderId) return { ok: false, error: "invalid" };
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, error: "error" };

  const { folders } = await listClientFolders(input.clientId);
  const self = folders.find((f) => f.id === input.folderId);
  if (!self) return { ok: false, error: "not_found" };

  const sb = await getServerSupabase();

  // Documents first: if this fails we have not removed anything yet, and the
  // user can try again against an unchanged tree.
  for (const table of DOC_TABLES) {
    const { error } = await sb
      .from(table)
      .update({ folder_id: self.parentId })
      .eq("folder_id", input.folderId);
    if (error && !isSchemaMissing(error)) {
      console.error("[folders] reparent documents failed:", table, error.code, error.message);
      return { ok: false, error: "error" };
    }
  }

  // Then sub-folders, up one level.
  {
    const { error } = await sb
      .from("document_folders")
      .update({ parent_id: self.parentId })
      .eq("parent_id", input.folderId);
    if (error) {
      console.error("[folders] reparent subfolders failed:", error.code, error.message);
      return { ok: false, error: "error" };
    }
  }

  // THE WRITE THAT SETS deleted_at GOES THROUGH THE SERVICE ROLE.
  //
  // Through the session client this fails with 42501, "new row violates
  // row-level security policy" — observed, not assumed. The policy's own
  // clauses reference deleted_at, so the row it is being asked to write is one
  // the policy will not accept, and the update is refused even though the
  // caller may plainly see and edit the folder.
  //
  // Authorization is NOT skipped here: listClientFolders above read this folder
  // through RLS, so the caller has already proven they can see it, and that
  // read applied the firm scope and the private-client rule. This is the same
  // discipline the rest of the codebase uses when the service role is needed
  // for a write the policy cannot express — prove scope first, then act.
  //
  // Note also there is no .select(): once deleted_at is set the row stops
  // satisfying its own SELECT policy, so RETURNING would come back empty on
  // SUCCESS and read as "not found".
  const { error: delErr } = await getServiceRoleSupabase()
    .from("document_folders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.folderId)
    // Belt and braces on top of the RLS-proved read above: the service role
    // bypasses policies, so the firm scope is re-stated by hand.
    .eq("firm_id", firm.id);
  if (delErr) {
    console.error("[folders] soft delete failed:", delErr.code, delErr.message);
    return { ok: false, error: isSchemaMissing(delErr) ? "unavailable" : "error" };
  }

  await logUserActivity(firm.id, null, "folder_deleted", {
    client_id: input.clientId,
    folder_id: input.folderId,
    name: self.name,
  });
  revalidatePath("/files");
  return { ok: true };
}

/**
 * Move every document in a derived bucket into a folder.
 *
 * Dragging the "Bookkeeping & business" folder onto "Payroll" cannot move the
 * folder — a year or category folder is COMPUTED from the documents inside it,
 * there is no row to re-parent. But the gesture obviously means something, and
 * what it means is "put this lot in there". So it moves the contents.
 *
 * Without this, dragging one of those folders would have to do nothing, and a
 * gesture that silently does nothing is indistinguishable from a broken app.
 */
export async function moveBucketToFolderAction(input: {
  clientId: string;
  /** undefined = not filtering on year; null = the Unsorted year. */
  year?: number | null;
  yearSet?: boolean;
  category?: string | null;
  categorySet?: boolean;
  folderId: string | null;
}): Promise<MoveResult> {
  const firm = await getCurrentFirm();
  if (!firm || !input.clientId) {
    return { ok: false, succeeded: 0, failed: 0, skipped: 0 };
  }
  const sb = await getServerSupabase();

  // Read the bucket through the view, so RLS decides which documents this user
  // may touch — the same gate every other document read uses.
  let q = sb
    .from("firm_documents")
    .select("source, id, folder_id")
    .eq("client_id", input.clientId)
    .is("deleted_at", null);
  if (input.yearSet) {
    q = input.year == null ? q.is("browse_year", null) : q.eq("browse_year", input.year);
  }
  if (input.categorySet) {
    q =
      input.category == null
        ? q.is("browse_category", null)
        : q.eq("browse_category", input.category);
  }
  const { data, error } = await q.limit(500);
  if (error || !data) return { ok: false, succeeded: 0, failed: 0, skipped: 0 };

  const rows = data as Array<{ source: string; id: string; folder_id: string | null }>;
  // Documents already in the destination are not moved and are not counted as
  // moved. Dropping a year onto the folder it already lives in should say so,
  // not report a number that makes the unchanged screen look like a bug.
  const targets = rows.filter((d) => d.folder_id !== input.folderId);
  const alreadyThere = rows.length - targets.length;

  if (targets.length === 0) {
    return { ok: true, succeeded: 0, failed: 0, skipped: alreadyThere };
  }
  const res = await setDocumentsFolderAction({
    targets: targets.map((d) => ({ source: d.source, id: d.id })),
    folderId: input.folderId,
  });
  return { ...res, skipped: res.skipped + alreadyThere };
}

/**
 * File documents into a folder, or back out of one.
 *
 * A null folderId returns them to the derived year/category view rather than
 * leaving them nowhere — a document must always be reachable.
 */
export async function setDocumentsFolderAction(input: {
  targets: { source: string; id: string }[];
  folderId: string | null;
}): Promise<MoveResult> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, succeeded: 0, failed: 0, skipped: 0 };
  // Interpolated into a PostgREST `or=` filter below, so it must be proven to
  // be a uuid and nothing else.
  if (input.folderId !== null && !UUID_RE.test(input.folderId)) {
    return { ok: false, succeeded: 0, failed: 0, skipped: 0 };
  }
  const sb = await getServerSupabase();

  const TABLE: Record<string, string> = {
    checklist: "uploaded_files",
    final: "final_documents",
    imported: "imported_documents",
  };

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const t of (input.targets ?? []).slice(0, 200)) {
    const table = TABLE[t.source];
    if (!table || !t.id) {
      failed++;
      continue;
    }
    // The update is CONSTRAINED to rows that would actually change. Postgres
    // happily "updates" a row to the value it already holds and returns it, so
    // an unconstrained write reports success for a document that never moved —
    // which is how dropping a year on the root crumb answered "14 files moved"
    // while nothing on screen changed. Here a no-op matches nothing, comes back
    // empty, and is counted as skipped rather than moved.
    let q = sb.from(table).update({ folder_id: input.folderId }).eq("id", t.id);
    q =
      input.folderId === null
        ? q.not("folder_id", "is", null)
        : q.or(`folder_id.is.null,folder_id.neq.${input.folderId}`);
    const { data, error } = await q.select("id").maybeSingle();
    if (error) failed++;
    else if (data) succeeded++;
    // No row came back: already in that folder, or not visible to this user.
    // Both mean nothing moved, which is what the caller needs to say.
    else skipped++;
  }

  if (succeeded > 0) {
    await logUserActivity(firm.id, null, "file_moved", {
      folder_id: input.folderId,
      count: succeeded,
      via: "folder",
    });
  }
  revalidatePath("/files");
  return { ok: failed === 0, succeeded, failed, skipped };
}
