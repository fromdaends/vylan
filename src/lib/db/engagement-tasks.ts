// The firm's own work — reading and writing tasks.
//
// A task belongs to a CLIENT. A job is optional (1350). That is the founder's
// call and the example that settles it: a client gets a CRA notice and somebody
// has to phone about it. Real work, belongs to that client, part of no tax
// return. Before 1350 it had nowhere to live but a fake job invented to hold it.
//
// Deliberately NOT part of items.ts: that module owns request_items, which is
// the CLIENT'S checklist. The two lists have different audiences, and one file
// that read both would be one refactor away from a query returning the firm's
// private notes to a portal route.
//
// THE TABLE IS STILL CALLED engagement_tasks. The founder asked for no renames
// and is right that it buys nothing — a table name is not a user-facing word.
// The name is now slightly wrong; that is the trade.
//
// READS DEGRADE, WRITES REFUSE, the same shape as client-members.ts. Before
// 1340/1350 there is no table: a read returns "no work yet", which is the
// truth, and a write names the file to run.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * What sort of work a task is, and therefore which screen it opens (1370).
 *
 * The three built-in kinds POINT AT collections that live elsewhere —
 * request_items and final_documents — and never copy them. That is the whole
 * safety property: the client portal, the AI classifier and the filing engine
 * all read those tables directly and none of them know this one exists.
 *
 * "task" is the plain kind and has no screen. A title, some owners and a
 * checkbox is the whole of it, so a row that led somewhere would lead to a
 * page showing one line.
 */
export const TASK_KINDS = [
  "document_collection",
  "signatures",
  "deliverables",
  "task",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** The kinds that open a screen. A plain task does not. */
export const KINDS_WITH_SCREENS: readonly TaskKind[] = [
  "document_collection",
  "signatures",
  "deliverables",
];

/** Anything unrecognised is a plain task — a kind from a newer build must
 *  still render in an older one rather than blanking the row. */
export function toTaskKind(v: unknown): TaskKind {
  return (TASK_KINDS as readonly string[]).includes(v as string)
    ? (v as TaskKind)
    : "task";
}

export const TASK_PRIORITIES = ["none", "low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Anything unrecognised reads as "none" rather than throwing — same rule as
 *  toTaskStatus, and for the same reason: a row written by a newer build must
 *  still render in an older one mid-rollout. */
export function toTaskPriority(v: unknown): TaskPriority {
  return TASK_PRIORITIES.includes(v as TaskPriority) ? (v as TaskPriority) : "none";
}

export type EngagementTask = {
  id: string;
  /** Always set. The task's real parent. */
  clientId: string;
  /** Null for a task that belongs to the client alone. */
  engagementId: string | null;
  title: string;
  kind: TaskKind;
  notes: string | null;
  /** Everybody on it. Empty is a real state — "somebody needs to do this". */
  assigneeIds: string[];
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  orderIndex: number;
  completedAt: string | null;
};

/** A task plus the names around it — what a firm-wide list needs to render. */
export type FirmTask = EngagementTask & {
  clientName: string | null;
  engagementTitle: string | null;
};

export class EngagementTasksUnsupportedError extends Error {
  constructor() {
    super(
      "Tasks need database updates 1340 and 1350. Run supabase/migrations/1340_engagement_tasks.sql then 1350_tasks_belong_to_clients.sql, and try again.",
    );
    this.name = "EngagementTasksUnsupportedError";
  }
}

/** Anything unrecognised reads as "todo" rather than throwing — a task written
 *  by a newer build must still render in an older one during a rollout. */
export function toTaskStatus(v: unknown): TaskStatus {
  return v === "doing" || v === "done" ? v : "todo";
}

const SELECT =
  "id, client_id, engagement_id, title, kind, notes, status, priority, due_date, order_index, completed_at, engagement_task_assignees(user_id)";

function toTask(r: Record<string, unknown>): EngagementTask | null {
  const id = typeof r.id === "string" ? r.id : null;
  const clientId = typeof r.client_id === "string" ? r.client_id : null;
  const title = typeof r.title === "string" ? r.title : null;
  if (!id || !clientId || !title) return null;
  // PostgREST returns an embedded set as an array; be defensive about the
  // single-object shape too rather than assuming one.
  const raw = r.engagement_task_assignees;
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return {
    id,
    clientId,
    engagementId: typeof r.engagement_id === "string" ? r.engagement_id : null,
    title,
    kind: toTaskKind(r.kind),
    notes: typeof r.notes === "string" && r.notes.trim() ? r.notes : null,
    assigneeIds: rows
      .map((a) => (a as { user_id?: unknown }).user_id)
      .filter((u): u is string => typeof u === "string"),
    status: toTaskStatus(r.status),
    priority: toTaskPriority(r.priority),
    dueDate: typeof r.due_date === "string" ? r.due_date : null,
    orderIndex: typeof r.order_index === "number" ? r.order_index : 0,
    completedAt: typeof r.completed_at === "string" ? r.completed_at : null,
  };
}

/** One job's tasks, in display order. */
export async function listEngagementTasks(
  engagementId: string,
): Promise<EngagementTask[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_tasks")
    .select(SELECT)
    .eq("engagement_id", engagementId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? [])
    .map((r) => toTask(r as Record<string, unknown>))
    .filter((t): t is EngagementTask => t !== null);
}

/**
 * EVERY task in the firm — the query the Work list is built on, and the reason
 * this is a first-class object rather than a tab on one job.
 *
 * Joins the client and (when there is one) the job, so a row can say who it is
 * for. ONE query, not one per row: a firm-wide list resolving names per task
 * would open with a round trip per row.
 *
 * RLS does the scoping, and 1350 taught it both shapes — a task with a job
 * follows the job, a task without one follows the client's list. Nothing here
 * has to know that.
 */
export async function listFirmTasks(): Promise<FirmTask[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_tasks")
    .select(`${SELECT}, clients(display_name), engagements(title)`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  const out: FirmTask[] = [];
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const base = toTask(r);
    if (!base) continue;
    const c = (Array.isArray(r.clients) ? r.clients[0] : r.clients) as
      | Record<string, unknown>
      | undefined;
    const e = (Array.isArray(r.engagements)
      ? r.engagements[0]
      : r.engagements) as Record<string, unknown> | undefined;
    out.push({
      ...base,
      clientName: typeof c?.display_name === "string" ? c.display_name : null,
      engagementTitle: typeof e?.title === "string" ? e.title : null,
    });
  }
  return out;
}

export async function createEngagementTask(input: {
  clientId: string;
  /** Omit for a task that belongs to the client alone. */
  engagementId?: string | null;
  firmId: string;
  title: string;
  /** Defaults to a plain task — the kind with no screen and no collection. */
  kind?: TaskKind;
  dueDate?: string | null;
  priority?: TaskPriority;
  /** Everybody to put on it at creation. The founder: "creating a task should
   *  ask for a due date and whatever relevant information. Not only after." */
  assigneeIds?: string[];
  createdBy?: string | null;
  /** Appended, so a new step lands at the bottom rather than the top. */
  orderIndex: number;
}): Promise<string> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_tasks")
    .insert({
      client_id: input.clientId,
      engagement_id: input.engagementId ?? null,
      firm_id: input.firmId,
      title: input.title,
      kind: input.kind ?? "task",
      due_date: input.dueDate ?? null,
      priority: input.priority ?? "none",
      order_index: input.orderIndex,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingSchema(error)) throw new EngagementTasksUnsupportedError();
    throw error;
  }
  const id = (data as { id: string }).id;

  // Assignees are a join table, so they are a second write. Deliberately NOT
  // fatal: a task that exists with nobody on it is recoverable in one click,
  // and one that failed to exist because the join insert did is not.
  const people = [...new Set(input.assigneeIds ?? [])];
  if (people.length > 0) {
    const { error: assignErr } = await supabase
      .from("engagement_task_assignees")
      .insert(people.map((userId) => ({ task_id: id, user_id: userId })));
    if (assignErr) {
      console.error("[engagement-tasks] assign-on-create failed:", assignErr);
    }
  }
  return id;
}

/**
 * Change one field, or several.
 *
 * completed_at is derived here rather than trusted from the caller: it is the
 * only field whose value has to agree with `status`, and a row saying "done"
 * with no completion time is what a report quietly gets wrong six months later.
 */
export async function updateEngagementTask(input: {
  taskId: string;
  firmId: string;
  patch: {
    title?: string;
    notes?: string | null;
    status?: TaskStatus;
    dueDate?: string | null;
    priority?: TaskPriority;
  };
  actorId?: string | null;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const row: Record<string, unknown> = {};
  const p = input.patch;
  if (p.title !== undefined) row.title = p.title;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.dueDate !== undefined) row.due_date = p.dueDate;
  if (p.priority !== undefined) row.priority = p.priority;
  if (p.status !== undefined) {
    row.status = p.status;
    row.completed_at = p.status === "done" ? new Date().toISOString() : null;
    row.completed_by = p.status === "done" ? (input.actorId ?? null) : null;
  }
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase
    .from("engagement_tasks")
    .update(row)
    .eq("id", input.taskId)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new EngagementTasksUnsupportedError();
    throw error;
  }
}

/**
 * Put somebody on a task, or take them off.
 *
 * A row per person rather than a column, because a task genuinely has more than
 * one name on it — preparer and reviewer is the ordinary case, not the
 * exception. Adding this after the table had rows would have meant rewriting
 * every read of it, which is why it went in while the table was still empty.
 */
export async function setTaskAssignee(input: {
  taskId: string;
  userId: string;
  firmId: string;
  on: boolean;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = input.on
    ? await supabase.from("engagement_task_assignees").upsert(
        { task_id: input.taskId, user_id: input.userId, firm_id: input.firmId },
        { onConflict: "task_id,user_id" },
      )
    : await supabase
        .from("engagement_task_assignees")
        .delete()
        .eq("task_id", input.taskId)
        .eq("user_id", input.userId)
        .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new EngagementTasksUnsupportedError();
    throw error;
  }
}

export async function deleteEngagementTask(input: {
  taskId: string;
  firmId: string;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagement_tasks")
    .delete()
    .eq("id", input.taskId)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new EngagementTasksUnsupportedError();
    throw error;
  }
}
