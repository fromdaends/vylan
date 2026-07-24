// Team Wave 3 — file comments + @mentions (migration 0800). Firm-internal
// comments on an uploaded document. Authenticated (RLS firm-scoped) reads +
// writes; the client never touches this. Everything degrades gracefully
// (isMissingFileCommentsSchema) before 0800 is applied to prod (dev uses remote
// Supabase). Author name is denormalized at write time so the thread survives a
// teammate's removal.

import { getServerSupabase } from "@/lib/supabase/server";
import { userDisplayLabel } from "@/lib/db/users";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FileComment = {
  id: string;
  uploadedFileId: string;
  authorUserId: string | null;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
};

// Missing TABLE (PGRST205 / 42P01) or COLUMN (PGRST204 / 42703) — degrade to
// "not activated yet" until 0800 lands. Match on codes ONLY (repo rule).
export function isMissingFileCommentsSchema(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

function toComment(row: Record<string, unknown>): FileComment {
  return {
    id: String(row.id),
    uploadedFileId: String(row.uploaded_file_id ?? ""),
    authorUserId: (row.author_user_id as string | null) ?? null,
    authorName: (row.author_name as string | null) ?? "",
    body: (row.body as string | null) ?? "",
    mentions: Array.isArray(row.mentions) ? (row.mentions as string[]) : [],
    createdAt: (row.created_at as string | null) ?? "",
  };
}

// Overwrite each comment's denormalized author_name with the author's CURRENT
// display name (resolved live from the users row), so a teammate renaming
// themselves updates their name on EVERY past comment — like the rest of the
// team UI (roster, assignee, activity all resolve live). The stored author_name
// stays the fallback for an author who has LEFT the firm (their users row is no
// longer visible via RLS → not in the map → keep the name captured at write).
async function applyLiveAuthorNames(
  sb: SupabaseClient,
  comments: FileComment[],
): Promise<FileComment[]> {
  const ids = [
    ...new Set(
      comments.map((c) => c.authorUserId).filter((x): x is string => !!x),
    ),
  ];
  if (ids.length === 0) return comments;
  const { data } = await sb
    .from("users")
    .select("id, display_name, name, email")
    .in("id", ids);
  const nameById = new Map<string, string>();
  for (const u of (data as Array<{
    id: string;
    display_name: string | null;
    name: string;
    email: string;
  }> | null) ?? []) {
    nameById.set(u.id, userDisplayLabel(u));
  }
  if (nameById.size === 0) return comments;
  return comments.map((c) =>
    c.authorUserId && nameById.has(c.authorUserId)
      ? { ...c, authorName: nameById.get(c.authorUserId) as string }
      : c,
  );
}

// One file's comments, oldest first. [] pre-0800 / on error.
export async function listFileComments(
  uploadedFileId: string,
): Promise<FileComment[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("file_comments")
    .select(
      "id, uploaded_file_id, author_user_id, author_name, body, mentions, created_at",
    )
    .eq("uploaded_file_id", uploadedFileId)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingFileCommentsSchema(error)) {
      console.error("[file-comments] listFileComments failed:", error);
    }
    return [];
  }
  const comments = ((data as Array<Record<string, unknown>> | null) ?? []).map(
    toComment,
  );
  return applyLiveAuthorNames(sb, comments);
}

// All comments for a set of files in ONE query, grouped by file (oldest first
// within each). For the engagement page, which renders a thread under every
// file. Empty map pre-0800 / on error.
export async function listCommentsForFiles(
  uploadedFileIds: string[],
): Promise<Map<string, FileComment[]>> {
  const out = new Map<string, FileComment[]>();
  if (uploadedFileIds.length === 0) return out;
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("file_comments")
    .select(
      "id, uploaded_file_id, author_user_id, author_name, body, mentions, created_at",
    )
    .in("uploaded_file_id", uploadedFileIds)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingFileCommentsSchema(error)) {
      console.error("[file-comments] listCommentsForFiles failed:", error);
    }
    return out;
  }
  const flat = await applyLiveAuthorNames(
    sb,
    ((data as Array<Record<string, unknown>> | null) ?? []).map(toComment),
  );
  for (const c of flat) {
    const arr = out.get(c.uploadedFileId) ?? [];
    arr.push(c);
    out.set(c.uploadedFileId, arr);
  }
  return out;
}

// Comment count per file, for the badge on the engagement's file rows. Empty
// map pre-0800 / on error (the badge just doesn't show).
export async function countFileComments(
  uploadedFileIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (uploadedFileIds.length === 0) return out;
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("file_comments")
    .select("uploaded_file_id")
    .in("uploaded_file_id", uploadedFileIds);
  if (error) {
    if (!isMissingFileCommentsSchema(error)) {
      console.error("[file-comments] countFileComments failed:", error);
    }
    return out;
  }
  for (const r of (data as Array<Record<string, unknown>> | null) ?? []) {
    const id = String(r.uploaded_file_id ?? "");
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export type InsertFileCommentResult =
  | { ok: true; comment: FileComment }
  | { ok: false; error: "schema" | "failed" };

// Insert a comment as the current user (RLS enforces firm + self-authorship +
// engagement containment). `mentions` should already be sanitized to real firm
// member ids by the caller.
export async function insertFileComment(input: {
  firmId: string;
  engagementId: string;
  uploadedFileId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  mentions: string[];
}): Promise<InsertFileCommentResult> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("file_comments")
    .insert({
      firm_id: input.firmId,
      engagement_id: input.engagementId,
      uploaded_file_id: input.uploadedFileId,
      author_user_id: input.authorUserId,
      author_name: input.authorName,
      body: input.body,
      mentions: input.mentions,
    })
    .select(
      "id, uploaded_file_id, author_user_id, author_name, body, mentions, created_at",
    )
    .single();
  if (error) {
    if (isMissingFileCommentsSchema(error)) return { ok: false, error: "schema" };
    console.error("[file-comments] insertFileComment failed:", error);
    return { ok: false, error: "failed" };
  }
  return { ok: true, comment: toComment(data as Record<string, unknown>) };
}

// Delete a comment. RLS permits it only for the author (own firm); a
// non-author's delete affects 0 rows and still returns ok (idempotent).
export async function deleteFileComment(id: string): Promise<boolean> {
  const sb = await getServerSupabase();
  const { error } = await sb.from("file_comments").delete().eq("id", id);
  if (error) {
    if (!isMissingFileCommentsSchema(error)) {
      console.error("[file-comments] deleteFileComment failed:", error);
    }
    return false;
  }
  return true;
}
