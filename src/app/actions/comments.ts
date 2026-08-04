"use server";

// ONE door for commenting, on all five targets (1520).
//
// WHY THIS EXISTS ALONGSIDE actions/file-comments.ts. That file is the original
// engagement-page path: the page is a Server Component, it loads every comment
// on the engagement in one query and hands each thread its rows as props. That
// is the right shape THERE and it is untouched.
//
// This file serves the surfaces that CANNOT be fed that way — a task opened in
// the side panel, a client's notes — because the pages that render them are
// owned by other live sessions, and because a drop-in thread that fetches its
// own rows is the thing the founder actually asked for: "theres a build going on
// adding a sidebar view for engagements and thats where the commenting thing
// should exist". A component that needs three props wired through a Server
// Component is not a drop-in; one that needs a target is.
//
// The cost is one small request when a thread opens, not on page render — the
// list stays as fast as it was, and a thread nobody opens costs nothing.
//
// "use server" files export ASYNC ONLY (a non-async export throws at build in a
// way only `next build` catches — this repo has shipped that bug before).

import { getServerSupabase } from "@/lib/supabase/server";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  insertFileComment,
  deleteFileComment,
  listByTargetOrMissing,
  listCommentsForEngagement,
  countCommentsByTarget,
  COMMENTS_SCHEMA_MISSING,
  type FileComment,
} from "@/lib/db/file-comments";
import {
  listClientNotes,
  createClientNote,
  deleteClientNote,
} from "@/lib/db/client-notes";
import { sanitizeMentions } from "@/lib/team/mentions";
import { clientName, emitInternalMention } from "@/lib/notifications/emit";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

// What a thread hangs off. Serializable — it crosses the server boundary.
export type CommentTargetInput =
  | { kind: "task"; taskId: string }
  | { kind: "client"; clientId: string }
  // The ENGAGEMENT itself. This target has existed in the data since 0930
  // ("every target column null") and the engagement PAGE already renders it
  // through the props-fed popover. It is repeated here so the SELF-LOADING
  // thread can carry it too — which is what let it drop into the engagement
  // SIDEBAR (#1311) the founder asked for: "theres a build going on adding a
  // sidebar view for engagements and thats where the commenting thing should
  // exist". Both routes read and write the same rows, so a comment left in the
  // sidebar is the same comment the page shows.
  | { kind: "engagement"; engagementId: string };

// A note that still lives in client_notes (1270) because 1520 has not been
// applied yet carries this prefix on its id, so a later delete knows which
// table to go to. Without it, deleting a pre-migration note would silently miss.
const LEGACY_NOTE_PREFIX = "note:";

export type CommentThreadData = {
  comments: FileComment[];
  members: { id: string; name: string }[];
  currentUserId: string | null;
  // True when the rows came from client_notes because 1520 is unapplied. The UI
  // uses it for one thing only: hiding the @ button, since a legacy note has
  // nowhere to store mentions and offering the control would silently drop them.
  legacy: boolean;
};

// Everything a thread needs, in one round trip: its comments, the people who
// can be @mentioned, and who is reading. Fetched when the thread mounts.
export async function loadCommentThreadAction(
  target: CommentTargetInput,
): Promise<CommentThreadData> {
  const [user, members] = await Promise.all([getCurrentUser(), listFirmUsers()]);
  const empty: CommentThreadData = {
    comments: [],
    members: [],
    currentUserId: null,
    legacy: false,
  };
  if (!user) return empty;

  const mentionable = members
    .filter((m) => !m.deactivated_at)
    .map((m) => ({ id: m.id, name: userDisplayLabel(m) }));

  if (target.kind === "task") {
    const res = await listByTargetOrMissing(
      "engagement_task_id",
      target.taskId,
      "loadCommentThreadAction(task)",
    );
    return {
      // A task thread has no older home to fall back to — nothing could write
      // one before 1520 — so an unapplied migration is simply an empty thread.
      comments: res === COMMENTS_SCHEMA_MISSING ? [] : res,
      members: mentionable,
      currentUserId: user.id,
      legacy: false,
    };
  }

  if (target.kind === "engagement") {
    // The engagement's OWN thread is the rows with no target column set, so it
    // cannot be read with a simple .eq() — reuse the page's grouped reader and
    // take the engagement bucket. That bucket already excludes file, item and
    // task comments, which is the whole reason groupEngagementComments has a
    // byTask bucket at all.
    const grouped = await listCommentsForEngagement(target.engagementId);
    return {
      comments: grouped.engagement,
      members: mentionable,
      currentUserId: user.id,
      legacy: false,
    };
  }

  const res = await listByTargetOrMissing(
    "client_id",
    target.clientId,
    "loadCommentThreadAction(client)",
  );
  if (res !== COMMENTS_SCHEMA_MISSING) {
    return {
      comments: res,
      members: mentionable,
      currentUserId: user.id,
      legacy: false,
    };
  }

  // 1520 is not applied. Read the OLD table so the founder's existing notes stay
  // on screen — an empty box where notes used to be is the worst possible way to
  // ship this, and it is exactly what a bare `return []` would have done.
  const notes = await listClientNotes(target.clientId);
  return {
    // client_notes reads newest-first; a comment thread reads oldest-first.
    comments: notes
      .slice()
      .reverse()
      .map((n) => ({
        id: `${LEGACY_NOTE_PREFIX}${n.id}`,
        uploadedFileId: null,
        requestItemId: null,
        engagementTaskId: null,
        clientId: n.clientId,
        authorUserId: n.authorUserId,
        authorName: n.authorName,
        body: n.body,
        mentions: [],
        createdAt: n.createdAt,
      })),
    members: mentionable,
    currentUserId: user.id,
    legacy: true,
  };
}

// Comment counts for a whole table, in one call. The rows then know which of
// them carry a bubble without each one asking.
export async function loadCommentCountsAction(input: {
  kind: "task" | "client";
  ids: string[];
}): Promise<Record<string, number>> {
  const user = await getCurrentUser();
  if (!user) return {};
  // Bound it: a caller passing an unbounded list would build a URL long enough
  // to be rejected by PostgREST, and a silently truncated count is better than
  // a failed request that leaves every bubble missing.
  const ids = (input.ids ?? []).filter(Boolean).slice(0, 500);
  return countCommentsByTarget(
    input.kind === "task" ? "engagement_task_id" : "client_id",
    ids,
  );
}

export type AddCommentResult =
  | { ok: true; comment: FileComment }
  | { ok: false; error: "no_session" | "empty" | "too_long" | "failed" };

export async function addCommentAction(input: {
  target: CommentTargetInput;
  body: string;
  mentions: string[];
}): Promise<AddCommentResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };

  const body = (input.body ?? "").trim();
  if (body.length === 0) return { ok: false, error: "empty" };
  if (body.length > 4000) return { ok: false, error: "too_long" };

  const members = await listFirmUsers();
  const validIds = new Set(
    members.filter((m) => !m.deactivated_at).map((m) => m.id),
  );
  const mentions = sanitizeMentions(input.mentions ?? [], validIds, user.id);
  const authorName = userDisplayLabel(user);

  if (input.target.kind === "engagement") {
    // Every target column stays null — that IS the engagement target (0930).
    const engagementId = input.target.engagementId;
    const sb = await getServerSupabase();
    const { data } = await sb
      .from("engagements")
      .select("id, client_id")
      .eq("id", engagementId)
      .maybeSingle();
    const eng = data as { id: string; client_id: string } | null;
    if (!eng) return { ok: false, error: "failed" };

    const res = await insertFileComment({
      firmId: firm.id,
      engagementId,
      authorUserId: user.id,
      authorName,
      body,
      mentions,
    });
    if (!res.ok) return { ok: false, error: "failed" };

    await notifyMentions({
      mentions,
      firmId: firm.id,
      engagementId,
      clientId: eng.client_id,
      actorId: user.id,
      kind: "task",
      targetId: engagementId,
    });

    revalidateAllLocales(`/engagements/${engagementId}`);
    revalidateAllLocales("/engagements");
    return { ok: true, comment: res.comment };
  }

  if (input.target.kind === "task") {
    // Resolve the task's own engagement + client. engagement_id is DENORMALIZED
    // onto the comment so mention links and revalidation resolve to a page —
    // and it is legitimately null for a standalone task (1350), which is why
    // 1520 had to drop the NOT NULL. Reading it back also proves the task is
    // ours before we write: RLS would refuse anyway, but a clean "failed" beats
    // a policy violation in the log.
    const sb = await getServerSupabase();
    const { data } = await sb
      .from("engagement_tasks")
      .select("id, engagement_id, client_id")
      .eq("id", input.target.taskId)
      .maybeSingle();
    const task = data as {
      id: string;
      engagement_id: string | null;
      client_id: string;
    } | null;
    if (!task) return { ok: false, error: "failed" };

    const res = await insertFileComment({
      firmId: firm.id,
      engagementId: task.engagement_id,
      engagementTaskId: task.id,
      authorUserId: user.id,
      authorName,
      body,
      mentions,
    });
    if (!res.ok) return { ok: false, error: "failed" };

    await notifyMentions({
      mentions,
      firmId: firm.id,
      engagementId: task.engagement_id,
      clientId: task.client_id,
      actorId: user.id,
      kind: "task",
      targetId: task.id,
    });

    if (task.engagement_id) {
      revalidateAllLocales(`/engagements/${task.engagement_id}`);
    }
    revalidateAllLocales(`/clients/${task.client_id}`);
    revalidateAllLocales("/work");
    return { ok: true, comment: res.comment };
  }

  const clientId = input.target.clientId;
  const res = await insertFileComment({
    firmId: firm.id,
    clientId,
    authorUserId: user.id,
    authorName,
    body,
    mentions,
  });

  if (!res.ok) {
    if (res.error === "schema") {
      // 1520 unapplied — write the OLD table so a note is never lost just
      // because the database is behind the deployment.
      const legacy = await createClientNote({
        firmId: firm.id,
        clientId,
        authorUserId: user.id,
        authorName,
        body,
      });
      if (!legacy.ok) return { ok: false, error: "failed" };
      revalidateAllLocales(`/clients/${clientId}`);
      return {
        ok: true,
        comment: {
          id: `${LEGACY_NOTE_PREFIX}${legacy.note.id}`,
          uploadedFileId: null,
          requestItemId: null,
          engagementTaskId: null,
          clientId,
          authorUserId: legacy.note.authorUserId,
          authorName: legacy.note.authorName,
          body: legacy.note.body,
          mentions: [],
          createdAt: legacy.note.createdAt,
        },
      };
    }
    return { ok: false, error: "failed" };
  }

  await notifyMentions({
    mentions,
    firmId: firm.id,
    engagementId: null,
    clientId,
    actorId: user.id,
    kind: "client",
    targetId: clientId,
  });

  revalidateAllLocales(`/clients/${clientId}`);
  return { ok: true, comment: res.comment };
}

export async function deleteCommentAction(input: {
  id: string;
  target: CommentTargetInput;
}): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  // A pre-1520 note lives in the other table; its id says so.
  if (input.id.startsWith(LEGACY_NOTE_PREFIX)) {
    const ok = await deleteClientNote(input.id.slice(LEGACY_NOTE_PREFIX.length));
    if (ok && input.target.kind === "client") {
      revalidateAllLocales(`/clients/${input.target.clientId}`);
    }
    return { ok };
  }

  const ok = await deleteFileComment(input.id); // RLS: author-only
  if (ok) {
    if (input.target.kind === "client") {
      revalidateAllLocales(`/clients/${input.target.clientId}`);
    } else if (input.target.kind === "engagement") {
      revalidateAllLocales(`/engagements/${input.target.engagementId}`);
    } else {
      revalidateAllLocales("/work");
    }
  }
  return { ok };
}

// Best-effort mention fan-out, shared by both targets. A failed notification
// must NEVER fail the comment — the comment is the thing the person wanted.
async function notifyMentions(input: {
  mentions: string[];
  firmId: string;
  engagementId: string | null;
  clientId: string | null;
  actorId: string;
  kind: "task" | "client";
  targetId: string;
}): Promise<void> {
  if (input.mentions.length === 0) return;

  // KNOWN GAP, stated rather than hidden: both the activity row and the in-app
  // notification are ENGAGEMENT-scoped — emitInternalMention builds its link as
  // `/engagements/<id>`. A comment on a client, or on a standalone task with no
  // engagement (1350), has no such id, and inventing one would deliver a
  // notification whose link 404s. So the mention is still SAVED on the comment
  // (it highlights, and it is there when a client-scoped notification event is
  // added) but nothing is dispatched. A missing notification is recoverable; a
  // notification that goes nowhere teaches people to ignore the bell.
  const engagementId = input.engagementId;
  if (!engagementId) return;

  try {
    await logUserActivity(input.firmId, engagementId, "file_comment_mention", {
      [input.kind === "task" ? "engagement_task_id" : "client_comment_id"]:
        input.targetId,
      mentioned_user_ids: input.mentions,
      author_id: input.actorId,
    });
    const sb = await getServerSupabase();
    await emitInternalMention(
      sb,
      {
        firmId: input.firmId,
        engagementId,
        engagementTitle: null,
        clientId: input.clientId,
        clientName: await clientName(sb, input.clientId),
      },
      { actorId: input.actorId, mentionedUserIds: input.mentions },
    );
  } catch (e) {
    console.error("[comments] mention fan-out failed:", e);
  }
}
