"use server";

// The firm's own work on an engagement — create, edit, tick off, delete.
//
// OPEN TO ANYONE WHO CAN SEE THE ENGAGEMENT, deliberately, and that is a
// different gate from most of this codebase. A task list only one person may
// edit is a task list nobody uses; and RLS already decides who can see the
// engagement at all, so "can you see it" is the honest boundary here. The
// founder's own call on the sign-off switch was the same shape: finishing work
// is not a permission.
//
// This file exports async functions ONLY. A "use server" module with a sync
// export typechecks, lints, passes every test, and then fails the production
// build naming something unrelated.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  createEngagementTask,
  updateEngagementTask,
  deleteEngagementTask,
  listEngagementTasks,
  EngagementTasksUnsupportedError,
  type TaskStatus,
} from "@/lib/db/engagement-tasks";
import { revalidateAllLocales } from "@/lib/revalidate";

export type TaskActionResult = {
  ok: boolean;
  /** Set when database update 1340 has not been applied yet. */
  needsMigration?: boolean;
  error?: "no_session" | "bad_title" | "failed";
};

// A task's title is a sentence somebody has to act on, not an essay. Long
// enough for "Reconcile the Q3 bank statement against the trial balance".
const TITLE_MAX = 200;

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
  return t || null;
}

async function guard() {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "no_session" as const };
  return { user, firm };
}

function handle(err: unknown, what: string): TaskActionResult {
  if (err instanceof EngagementTasksUnsupportedError) {
    return { ok: false, needsMigration: true };
  }
  console.error(`[engagement-tasks] ${what} failed:`, err);
  return { ok: false, error: "failed" };
}

export async function addTaskAction(input: {
  engagementId: string;
  title: string;
  assignedUserId?: string | null;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "bad_title" };

  try {
    // Appended. Read the list first rather than keeping a counter: two people
    // adding at once would otherwise collide on the same index, and the order
    // is cosmetic enough that one extra read is the cheaper correctness.
    const existing = await listEngagementTasks(input.engagementId);
    await createEngagementTask({
      engagementId: input.engagementId,
      firmId: g.firm.id,
      title,
      assignedUserId: input.assignedUserId ?? null,
      createdBy: g.user.id,
      orderIndex: existing.length,
    });
  } catch (err) {
    return handle(err, "add");
  }

  revalidateAllLocales(`/engagements/${input.engagementId}`);
  return { ok: true };
}

export async function updateTaskAction(input: {
  engagementId: string;
  taskId: string;
  title?: string;
  assignedUserId?: string | null;
  status?: TaskStatus;
  dueDate?: string | null;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const patch: Parameters<typeof updateEngagementTask>[0]["patch"] = {};
  if (input.title !== undefined) {
    const title = cleanTitle(input.title);
    if (!title) return { ok: false, error: "bad_title" };
    patch.title = title;
  }
  if (input.assignedUserId !== undefined) {
    patch.assignedUserId = input.assignedUserId;
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;

  try {
    await updateEngagementTask({
      taskId: input.taskId,
      firmId: g.firm.id,
      patch,
      actorId: g.user.id,
    });
  } catch (err) {
    return handle(err, "update");
  }

  revalidateAllLocales(`/engagements/${input.engagementId}`);
  return { ok: true };
}

export async function deleteTaskAction(input: {
  engagementId: string;
  taskId: string;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  try {
    await deleteEngagementTask({ taskId: input.taskId, firmId: g.firm.id });
  } catch (err) {
    return handle(err, "delete");
  }

  revalidateAllLocales(`/engagements/${input.engagementId}`);
  return { ok: true };
}
