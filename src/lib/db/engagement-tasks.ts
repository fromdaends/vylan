// The firm's own work on an engagement — reading and writing its internal steps.
//
// Phase 4, step 1. Deliberately NOT part of items.ts: that module owns
// request_items, which is the CLIENT'S checklist, and the entire point of this
// table is that the two lists are different objects with different audiences.
// One file that read both would be one refactor away from a query that returns
// the firm's private notes to a portal route.
//
// READS DEGRADE, WRITES REFUSE, the same shape as client-members.ts and
// engagement-members.ts. Before 1340 is applied there is no table: a read
// returns "no internal work yet", which is exactly what a job nobody has
// planned should show, and a write names the file to run.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type EngagementTask = {
  id: string;
  engagementId: string;
  title: string;
  notes: string | null;
  assignedUserId: string | null;
  status: TaskStatus;
  dueDate: string | null;
  orderIndex: number;
  completedAt: string | null;
};

export class EngagementTasksUnsupportedError extends Error {
  constructor() {
    super(
      "Internal work needs database update 1340. Run supabase/migrations/1340_engagement_tasks.sql, then try again.",
    );
    this.name = "EngagementTasksUnsupportedError";
  }
}

/** Anything unrecognised reads as "todo" rather than throwing — a task with a
 *  status from a newer build must still render in an older one. */
export function toTaskStatus(v: unknown): TaskStatus {
  return v === "doing" || v === "done" ? v : "todo";
}

function toTask(r: Record<string, unknown>): EngagementTask | null {
  const id = typeof r.id === "string" ? r.id : null;
  const engagementId =
    typeof r.engagement_id === "string" ? r.engagement_id : null;
  const title = typeof r.title === "string" ? r.title : null;
  if (!id || !engagementId || !title) return null;
  return {
    id,
    engagementId,
    title,
    notes: typeof r.notes === "string" && r.notes.trim() ? r.notes : null,
    assignedUserId:
      typeof r.assigned_user_id === "string" ? r.assigned_user_id : null,
    status: toTaskStatus(r.status),
    dueDate: typeof r.due_date === "string" ? r.due_date : null,
    orderIndex: typeof r.order_index === "number" ? r.order_index : 0,
    completedAt: typeof r.completed_at === "string" ? r.completed_at : null,
  };
}

/** One engagement's internal steps, in display order. */
export async function listEngagementTasks(
  engagementId: string,
): Promise<EngagementTask[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_tasks")
    .select(
      "id, engagement_id, title, notes, assigned_user_id, status, due_date, order_index, completed_at",
    )
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

export async function createEngagementTask(input: {
  engagementId: string;
  firmId: string;
  title: string;
  assignedUserId?: string | null;
  dueDate?: string | null;
  createdBy?: string | null;
  /** Appended, so a new step lands at the bottom rather than the top. */
  orderIndex: number;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("engagement_tasks").insert({
    engagement_id: input.engagementId,
    firm_id: input.firmId,
    title: input.title,
    assigned_user_id: input.assignedUserId ?? null,
    due_date: input.dueDate ?? null,
    order_index: input.orderIndex,
    created_by: input.createdBy ?? null,
  });
  if (error) {
    if (isMissingSchema(error)) throw new EngagementTasksUnsupportedError();
    throw error;
  }
}

/**
 * Change one field, or several.
 *
 * completed_at is derived here rather than trusted from the caller: it is the
 * only field whose value has to agree with `status`, and a row that says "done"
 * with no completion time is the kind of thing a report quietly gets wrong six
 * months later.
 */
export async function updateEngagementTask(input: {
  taskId: string;
  firmId: string;
  patch: {
    title?: string;
    notes?: string | null;
    assignedUserId?: string | null;
    status?: TaskStatus;
    dueDate?: string | null;
  };
  actorId?: string | null;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const row: Record<string, unknown> = {};
  const p = input.patch;
  if (p.title !== undefined) row.title = p.title;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.assignedUserId !== undefined) row.assigned_user_id = p.assignedUserId;
  if (p.dueDate !== undefined) row.due_date = p.dueDate;
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
