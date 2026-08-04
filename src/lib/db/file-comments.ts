// Team Wave 3 — comments + @mentions (migration 0800, targets widened by 0930
// and again by 1510). Firm-internal comments on an uploaded FILE, a CHECKLIST
// ITEM (request_item_id), a TASK (engagement_task_id), a CLIENT (client_id), or
// the ENGAGEMENT itself (every target column null) — ONE table so RLS, mentions
// and author plumbing stay shared. Authenticated (RLS firm-scoped) reads +
// writes; the client never touches this. Everything degrades gracefully
// (isMissingFileCommentsSchema) before the SQL is applied (dev uses remote
// Supabase). Author name is denormalized at write time so the thread survives a
// teammate's removal.
//
// engagement_id is NULLABLE since 1510: a task can exist without an engagement
// (1350) and a client comment never has one. Callers must not assume it is set.

import { getServerSupabase } from "@/lib/supabase/server";
import { userDisplayLabel } from "@/lib/db/users";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FileComment = {
  id: string;
  // At most ONE of these four is set; all null = a comment on the engagement.
  uploadedFileId: string | null;
  requestItemId: string | null;
  engagementTaskId: string | null;
  clientId: string | null;
  authorUserId: string | null;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
};

// Every read/write returns the same row shape (0930 adds request_item_id; 1510
// adds engagement_task_id + client_id).
const COMMENT_SELECT =
  "id, uploaded_file_id, request_item_id, engagement_task_id, client_id, author_user_id, author_name, body, mentions, created_at";

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
    uploadedFileId: (row.uploaded_file_id as string | null) ?? null,
    requestItemId: (row.request_item_id as string | null) ?? null,
    engagementTaskId: (row.engagement_task_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
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
    .select(COMMENT_SELECT)
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

// Every comment on the engagement, split by target for the page: per-file
// threads, per-checklist-item threads, and the engagement-level thread
// (oldest first within each). Empty pre-0930 / on error.
export type EngagementComments = {
  byFile: Map<string, FileComment[]>;
  byItem: Map<string, FileComment[]>;
  byTask: Map<string, FileComment[]>;
  engagement: FileComment[];
};

// PURE: split a flat, already-sorted comment list by target. Exported for
// unit tests.
//
// THE `else` ARM IS THE DANGEROUS ONE. "No file and no item" used to mean "on
// the engagement", and 1510 made that false — a comment on a TASK also carries
// the engagement_id (so mention links and revalidation resolve), so it arrives
// in this same query and would land in the engagement's own thread. Task
// comments therefore get their own bucket ABOVE the fallback, and the fallback
// keeps its original meaning: nothing else claimed it, so it is the engagement.
export function groupEngagementComments(
  flat: FileComment[],
): EngagementComments {
  const out: EngagementComments = {
    byFile: new Map(),
    byItem: new Map(),
    byTask: new Map(),
    engagement: [],
  };
  for (const c of flat) {
    if (c.uploadedFileId) {
      const arr = out.byFile.get(c.uploadedFileId) ?? [];
      arr.push(c);
      out.byFile.set(c.uploadedFileId, arr);
    } else if (c.requestItemId) {
      const arr = out.byItem.get(c.requestItemId) ?? [];
      arr.push(c);
      out.byItem.set(c.requestItemId, arr);
    } else if (c.engagementTaskId) {
      const arr = out.byTask.get(c.engagementTaskId) ?? [];
      arr.push(c);
      out.byTask.set(c.engagementTaskId, arr);
    } else if (c.clientId) {
      // A client comment has no engagement_id at all, so it cannot reach this
      // query — but bucketing it explicitly keeps the fallback honest if a
      // future caller ever hands this function a mixed list.
      continue;
    } else {
      out.engagement.push(c);
    }
  }
  return out;
}

export async function listCommentsForEngagement(
  engagementId: string,
): Promise<EngagementComments> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("file_comments")
    .select(COMMENT_SELECT)
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingFileCommentsSchema(error)) {
      console.error("[file-comments] listCommentsForEngagement failed:", error);
    }
    return groupEngagementComments([]);
  }
  const flat = await applyLiveAuthorNames(
    sb,
    ((data as Array<Record<string, unknown>> | null) ?? []).map(toComment),
  );
  return groupEngagementComments(flat);
}

// One TASK's comments, oldest first (1510). [] before the SQL lands.
export async function listCommentsForTask(
  taskId: string,
): Promise<FileComment[]> {
  return listByTarget("engagement_task_id", taskId, "listCommentsForTask");
}

// One CLIENT's comments, oldest first (1510) — the successor to client_notes.
// [] before the SQL lands, which is what lets the caller fall back to the old
// table instead of showing an empty box where notes used to be.
export async function listCommentsForClient(
  clientId: string,
): Promise<FileComment[]> {
  return listByTarget("client_id", clientId, "listCommentsForClient");
}

// Shared body of the single-target reads. `schemaMissing` is reported back
// through a sentinel rather than swallowed, because the client-notes caller has
// to tell "no comments" apart from "1510 has not been applied" — the first
// renders an empty thread, the second must fall back to client_notes.
export const COMMENTS_SCHEMA_MISSING = Symbol("comments_schema_missing");

async function listByTarget(
  column: "engagement_task_id" | "client_id",
  id: string,
  label: string,
): Promise<FileComment[]> {
  const res = await listByTargetOrMissing(column, id, label);
  return res === COMMENTS_SCHEMA_MISSING ? [] : res;
}

export async function listByTargetOrMissing(
  column: "engagement_task_id" | "client_id",
  id: string,
  label: string,
): Promise<FileComment[] | typeof COMMENTS_SCHEMA_MISSING> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("file_comments")
    .select(COMMENT_SELECT)
    .eq(column, id)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingFileCommentsSchema(error)) return COMMENTS_SCHEMA_MISSING;
    console.error(`[file-comments] ${label} failed:`, error);
    return [];
  }
  const comments = ((data as Array<Record<string, unknown>> | null) ?? []).map(
    toComment,
  );
  return applyLiveAuthorNames(sb, comments);
}

// Client comments, or the sentinel when 1510 is still unapplied.
export async function listCommentsForClientOrMissing(
  clientId: string,
): Promise<FileComment[] | typeof COMMENTS_SCHEMA_MISSING> {
  return listByTargetOrMissing(
    "client_id",
    clientId,
    "listCommentsForClientOrMissing",
  );
}

export type InsertFileCommentResult =
  | { ok: true; comment: FileComment }
  | { ok: false; error: "schema" | "failed" };

// Insert a comment as the current user (RLS enforces firm + self-authorship +
// containment on every anchor that is set). Target: a file, a checklist item, a
// task, a client, or (none of them) the engagement itself — the DB CHECK rejects
// more than one at once. `mentions` should already be sanitized to real firm
// member ids by the caller.
//
// engagementId is optional since 1510: a standalone task and a client comment
// both legitimately have none.
export async function insertFileComment(input: {
  firmId: string;
  engagementId?: string | null;
  uploadedFileId?: string | null;
  requestItemId?: string | null;
  engagementTaskId?: string | null;
  clientId?: string | null;
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
      engagement_id: input.engagementId ?? null,
      uploaded_file_id: input.uploadedFileId ?? null,
      request_item_id: input.requestItemId ?? null,
      engagement_task_id: input.engagementTaskId ?? null,
      client_id: input.clientId ?? null,
      author_user_id: input.authorUserId,
      author_name: input.authorName,
      body: input.body,
      mentions: input.mentions,
    })
    .select(COMMENT_SELECT)
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
