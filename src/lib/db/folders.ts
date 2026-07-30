// Reading a client's custom folder tree.
//
// Every read goes through the RLS session client, so a private client's folder
// structure is exactly as visible as their documents — the policy in migration
// 1100 is the same clients_all shape, and it also excludes soft-deleted folders
// the way 1090 does for documents.

import { getServerSupabase } from "@/lib/supabase/server";
import type { FolderNode } from "@/lib/files/folder-tree";

export function isFolderSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

export type FolderRow = FolderNode & {
  clientId: string;
};

/**
 * A client's whole folder tree in one query.
 *
 * The WHOLE tree rather than one level, deliberately: the path bar, the
 * cycle guard and the "move to…" picker all need ancestors and descendants, and
 * fetching a level at a time would turn every one of those into a chain of
 * round-trips. A client's folder count is bounded by what a human will build by
 * hand — this is tens of rows, not thousands.
 */
export async function listClientFolders(clientId: string): Promise<{
  folders: FolderRow[];
  available: boolean;
}> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("document_folders")
    .select("id, client_id, parent_id, name")
    .eq("client_id", clientId)
    .order("name", { ascending: true });
  if (error) {
    if (!isFolderSchemaMissing(error)) {
      console.error("[folders] read failed:", error.message);
    }
    return { folders: [], available: !isFolderSchemaMissing(error) };
  }
  return {
    folders: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      clientId: r.client_id as string,
      parentId: (r.parent_id as string | null) ?? null,
      name: (r.name as string) ?? "",
    })),
    available: true,
  };
}

/** How many live documents sit directly in each folder, for the row counts. */
export async function folderDocumentCounts(
  clientId: string,
): Promise<Map<string, number>> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("firm_documents")
    .select("folder_id")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .not("folder_id", "is", null);
  const out = new Map<string, number>();
  if (error || !data) return out;
  for (const row of data as Array<{ folder_id: string }>) {
    out.set(row.folder_id, (out.get(row.folder_id) ?? 0) + 1);
  }
  return out;
}
