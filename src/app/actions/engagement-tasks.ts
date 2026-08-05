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

import {
  getCurrentUser,
  listActiveFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
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
  listTaskAssignees,
  restoreEngagementTask,
  purgeEngagementTask,
} from "@/lib/db/engagement-tasks";
import { listTaskStatuses } from "@/lib/db/task-statuses";
import { revalidateAllLocales } from "@/lib/revalidate";
import { guardBulkIds } from "@/lib/bulk/selection";

/**
 * Refresh every place a task can be read from.
 *
 * The Work list ALWAYS, because that is the point of the feature — a task
 * changed on a job must not leave the firm-wide list stale. The Overview too,
 * since the dashboard's stats strip and grouped Tasks card (design 2a) read
 * the same list. The job's own page only when there is a job; a client-only
 * task has no second home.
 */
function revalidateWork(engagementId?: string | null) {
  revalidateAllLocales("/work");
  revalidateAllLocales("/dashboard");
  if (engagementId) revalidateAllLocales(`/engagements/${engagementId}`);
}

// due_date is a plain calendar date; anything fancier is the client's bug.
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Everything the engagements list needs to open one job's task panel.
 *
 * Founder, on Canopy: "canopy has the feature to allow you to click on the
 * tasks like ex: 3/4 and it brings up a screen of all those tasks for that
 * specific engagement."
 *
 * ⚠️ LOADED ON DEMAND, NOT WITH THE LIST. A hundred-row engagements list would
 * otherwise fetch a hundred task sets, plus the roster and the statuses, to
 * draw a number you already have — for a panel that opens on maybe one row.
 *
 * Returns the roster and the firm's statuses ALONGSIDE the tasks so the panel
 * draws the same table the Tasks page and the engagement page draw, rather than
 * a read-only lookalike. One round trip, because three would show the panel
 * assembling itself in front of the user.
 */
export async function loadEngagementTasksPanelAction(engagementId: string): Promise<{
  ok: boolean;
  tasks: Awaited<ReturnType<typeof listEngagementTasks>>;
  members: { id: string; name: string }[];
  statuses: Awaited<ReturnType<typeof listTaskStatuses>>;
  currentUserId: string;
}> {
  const empty = {
    ok: false,
    tasks: [],
    members: [],
    statuses: [],
    currentUserId: "",
  };
  const user = await getCurrentUser();
  if (!user) return empty;
  // No firm check beyond this: RLS decides which engagement's tasks come back,
  // the same boundary every other reader in this file trusts. An id from
  // another firm returns nothing rather than erroring.
  const [tasks, members, statuses] = await Promise.all([
    listEngagementTasks(engagementId),
    listActiveFirmUsers(),
    listTaskStatuses(),
  ]);
  return {
    ok: true,
    tasks,
    members: members.map((m) => ({ id: m.id, name: userDisplayLabel(m) })),
    statuses,
    currentUserId: user.id,
  };
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
  /** Makes this a SUBTASK. The client and job are copied FROM the parent by a
   *  database trigger, so they cannot be set to something else from here. */
  parentId?: string | null;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "bad_title" };
  const dueDate =
    typeof input.dueDate === "string" && DUE_DATE_RE.test(input.dueDate)
      ? input.dueDate
      : null;

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
      // The validated form from above — a malformed date becomes null rather
      // than a database error.
      dueDate,
      priority: input.priority ?? "none",
      assigneeIds: input.assigneeIds,
      parentId: input.parentId ?? null,
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
  /** The firm's own status. Null clears it. */
  statusId?: string | null;
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
  if (input.statusId !== undefined) patch.statusId = input.statusId;

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

// ─────────────────────────────────────────────────────────────────────────────
// BULK
//
// The founder, after reading Canopy's bulk docs: "Do bulk for tasks and clients
// and well engagements but expand upon it so its not just reassigning."
//
// Canopy's task list offers Edit Status, Edit Priority, Edit Dates, Edit
// Assignees and Edit Roles, with Archive and End Recurrences behind "More".
// This covers the four Vylan actually has a single-row action for; a fifth that
// half-works is worse than four that do.
//
// ⚠️ PARTIAL SUCCESS IS REPORTED, NOT SWALLOWED. Each row is written on its own
// (there is no multi-row writer in db/engagement-tasks, and inventing one would
// bypass the per-task rules that live there), so some can land and some can
// fail — a task deleted in another tab, a status the row cannot take. The
// result carries `done` AND `failed` so the toast can say "8 of 10", because a
// bulk action that quietly does less than you asked is the worst kind: you
// cannot tell from the result which half happened.
// ─────────────────────────────────────────────────────────────────────────────

export type BulkTaskResult = {
  ok: boolean;
  done?: number;
  failed?: number;
  error?: "no_session" | "not_allowed" | "too_many" | "failed";
};

export async function bulkUpdateTasksAction(input: {
  taskIds: string[];
  /** Exactly one of these is acted on, in this order of precedence. */
  statusId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  /** Replaces the assignee set with this ONE person, or clears it with null. */
  assigneeId?: string | null;
  remove?: boolean;
  /** Bring them back out of the recycle bin (1650). */
  restore?: boolean;
}): Promise<BulkTaskResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const guarded = guardBulkIds(input.taskIds);
  if (!guarded.ok) return { ok: false, error: "too_many" };
  if (guarded.ids.length === 0) return { ok: true, done: 0, failed: 0 };

  let done = 0;
  let failed = 0;

  for (const taskId of guarded.ids) {
    try {
      if (input.restore) {
        await restoreEngagementTask({ taskId, firmId: g.firm.id });
      } else if (input.remove) {
        await deleteEngagementTask({
          taskId,
          firmId: g.firm.id,
          actorId: g.user.id,
        });
      } else if (input.assigneeId !== undefined) {
        // Replace rather than add: "assign these twelve to Marc" means Marc is
        // on them, not that Marc joins whoever was already there. Reading the
        // current set first keeps that true without a bespoke writer.
        const current = await listTaskAssignees(taskId);
        await Promise.all(
          current
            .filter((id) => id !== input.assigneeId)
            .map((id) =>
              setTaskAssignee({
                taskId,
                userId: id,
                firmId: g.firm.id,
                on: false,
              }),
            ),
        );
        if (input.assigneeId) {
          await setTaskAssignee({
            taskId,
            userId: input.assigneeId,
            firmId: g.firm.id,
            on: true,
          });
        }
      } else {
        await updateEngagementTask({
          taskId,
          firmId: g.firm.id,
          patch: {
            ...(input.statusId !== undefined ? { statusId: input.statusId } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          },
        });
      }
      done += 1;
    } catch (err) {
      console.error("[engagement-tasks] bulk row failed:", taskId, err);
      failed += 1;
    }
  }

  revalidateAllLocales("/work");
  revalidateAllLocales("/dashboard");
  revalidateAllLocales("/engagements");

  // ok reports whether ANYTHING landed; the counts say how much. A run where
  // every row failed is not a success with done:0.
  return { ok: done > 0 || failed === 0, done, failed };
}

// ── THE RECYCLE BIN (1650) ───────────────────────────────────────────────────
//
// Deleting a task now moves it here for 30 days instead of destroying it. These
// two are the ways back out: put it back, or finish the job early.

export async function restoreTaskAction(input: {
  taskId: string;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  try {
    await restoreEngagementTask({ taskId: input.taskId, firmId: g.firm.id });
  } catch (err) {
    return handle(err, "restore");
  }
  revalidateAllLocales("/work");
  revalidateAllLocales("/dashboard");
  return { ok: true };
}

/** Gone for good, before the cron would have done it. The bin's own control. */
export async function purgeTaskAction(input: {
  taskId: string;
}): Promise<TaskActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  try {
    await purgeEngagementTask({ taskId: input.taskId, firmId: g.firm.id });
  } catch (err) {
    return handle(err, "purge");
  }
  revalidateAllLocales("/work");
  return { ok: true };
}
