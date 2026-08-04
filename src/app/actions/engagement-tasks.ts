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
  setTaskAssignee,
  EngagementTasksUnsupportedError,
  type TaskStatus,
  type TaskKind,
  type TaskPriority,
} from "@/lib/db/engagement-tasks";
import { revalidateAllLocales } from "@/lib/revalidate";

/**
 * Refresh both places a task can be read from.
 *
 * The Work list ALWAYS, because that is the point of the feature — a task
 * changed on a job must not leave the firm-wide list stale. The job's own page
 * only when there is a job; a client-only task has no second home.
 */
function revalidateWork(engagementId?: string | null) {
  revalidateAllLocales("/work");
  if (engagementId) revalidateAllLocales(`/engagements/${engagementId}`);
}

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
  /** Required — every task is for somebody. */
  clientId: string;
  /** Omit for work that belongs to the client and no job. */
  engagementId?: string | null;
  title: string;
  /** Defaults to a plain task. The built-in kinds are limited to one per job
   *  by the database (1370), so a duplicate comes back as "failed" rather than
   *  silently making a second row that shows the same documents. */
  kind?: TaskKind;
  // The founder: "creating a task should ask for a due date and whatever
  // relevant information. Not only after." Setting a due date and an owner as
  // a second step after creating is how a list fills with unowned, undated
  // rows — the state this whole screen exists to make visible.
  dueDate?: string | null;
  priority?: TaskPriority;
  assigneeIds?: string[];
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "bad_title" };

  try {
    // Appended. Read the list first rather than keeping a counter: two people
    // adding at once would otherwise collide on the same index, and the order
    // is cosmetic enough that one extra read is the cheaper correctness.
    // A client-only task has no list to append to, so it starts at zero.
    const existing = input.engagementId
      ? await listEngagementTasks(input.engagementId)
      : [];
    await createEngagementTask({
      clientId: input.clientId,
      engagementId: input.engagementId ?? null,
      firmId: g.firm.id,
      title,
      kind: input.kind ?? "task",
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "none",
      assigneeIds: input.assigneeIds,
      createdBy: g.user.id,
      orderIndex: existing.length,
    });
  } catch (err) {
    return handle(err, "add");
  }

  revalidateWork(input.engagementId);
  return { ok: true };
}

/**
 * Put somebody on a task, or take them off.
 *
 * Its own action rather than a field on the update: assignment is a separate
 * table now (1350), and folding it into a patch would mean every caller had to
 * send the whole list to change one name.
 */
export async function setTaskAssigneeAction(input: {
  taskId: string;
  userId: string;
  on: boolean;
  engagementId?: string | null;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  try {
    await setTaskAssignee({
      taskId: input.taskId,
      userId: input.userId,
      firmId: g.firm.id,
      on: input.on,
    });
  } catch (err) {
    return handle(err, "assign");
  }
  revalidateWork(input.engagementId);
  return { ok: true };
}

export async function updateTaskAction(input: {
  taskId: string;
  /** Only so the job's page can be revalidated too. Optional like the link. */
  engagementId?: string | null;
  title?: string;
  status?: TaskStatus;
  dueDate?: string | null;
  /** Null clears it. Undefined leaves it alone — the two are different. */
  notes?: string | null;
  priority?: TaskPriority;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const patch: Parameters<typeof updateEngagementTask>[0]["patch"] = {};
  if (input.title !== undefined) {
    const title = cleanTitle(input.title);
    if (!title) return { ok: false, error: "bad_title" };
    patch.title = title;
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.priority !== undefined) patch.priority = input.priority;

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

  revalidateWork(input.engagementId);
  return { ok: true };
}

export async function deleteTaskAction(input: {
  taskId: string;
  engagementId?: string | null;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  try {
    await deleteEngagementTask({ taskId: input.taskId, firmId: g.firm.id });
  } catch (err) {
    return handle(err, "delete");
  }

  revalidateWork(input.engagementId);
  return { ok: true };
}
