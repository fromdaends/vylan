"use server";

// Team Wave 3 — comment actions (targets widened by 0930). Firm members post
// short comments on an uploaded document, a checklist item, or the engagement
// itself, and @mention teammates (who get an in-app notification via an
// activity_log row the Home feed reads). RLS enforces firm + self-authorship;
// this validates the body + target, sanitizes mentions to real members, and
// fans out the notification.
//
// DEPLOY-SKEW: uploadedFileId stays optional-but-accepted in its old shape, so
// a stale tab posting a file comment against the new server still works.

import { revalidatePath } from "next/cache";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  insertFileComment,
  deleteFileComment,
  type FileComment,
} from "@/lib/db/file-comments";
import { sanitizeMentions } from "@/lib/team/mentions";
import { logUserActivity } from "@/lib/db/activity";

const LOCALES = ["en", "fr"] as const;

export type AddFileCommentResult =
  | { ok: true; comment: FileComment }
  | { ok: false; error: string };

export async function addFileCommentAction(input: {
  engagementId: string;
  // At most one of these; neither = a comment on the engagement itself.
  uploadedFileId?: string | null;
  requestItemId?: string | null;
  body: string;
  mentions: string[];
}): Promise<AddFileCommentResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };

  if (input.uploadedFileId && input.requestItemId) {
    return { ok: false, error: "bad_target" };
  }
  const body = (input.body ?? "").trim();
  if (body.length === 0) return { ok: false, error: "empty" };
  if (body.length > 4000) return { ok: false, error: "too_long" };

  // Sanitize @mentions against the firm's ACTIVE members (never the author).
  const members = await listFirmUsers();
  const validIds = new Set(
    members.filter((m) => !m.deactivated_at).map((m) => m.id),
  );
  const mentions = sanitizeMentions(input.mentions ?? [], validIds, user.id);

  const res = await insertFileComment({
    firmId: firm.id,
    engagementId: input.engagementId,
    uploadedFileId: input.uploadedFileId ?? null,
    requestItemId: input.requestItemId ?? null,
    authorUserId: user.id,
    authorName: userDisplayLabel(user),
    body,
    mentions,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: res.error === "schema" ? "not_activated" : "failed",
    };
  }

  // Notify the mentioned teammates: ONE activity row that listHomeNotifications
  // turns into a per-mentioned-viewer "comment_mention". Best-effort — a failed
  // log never fails the comment.
  if (mentions.length > 0) {
    try {
      await logUserActivity(firm.id, input.engagementId, "file_comment_mention", {
        file_id: input.uploadedFileId ?? null,
        request_item_id: input.requestItemId ?? null,
        mentioned_user_ids: mentions,
        author_id: user.id,
      });
    } catch (e) {
      console.error("[file-comments] mention activity failed:", e);
    }
  }

  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/engagements/${input.engagementId}`);
  }
  return { ok: true, comment: res.comment };
}

export async function deleteFileCommentAction(input: {
  id: string;
  engagementId: string;
}): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ok = await deleteFileComment(input.id); // RLS: author-only
  if (ok) {
    for (const loc of LOCALES) {
      revalidatePath(`/${loc}/engagements/${input.engagementId}`);
    }
  }
  return { ok };
}
