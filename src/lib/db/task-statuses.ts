// The statuses a firm has named for itself.
//
// Every one belongs to a BUCKET — todo / doing / done — and that bucket is what
// the rest of the product reasons about: progress bars, the Active-work view,
// the completion rules, the sort order. Only the label and the colour are the
// firm's. See 1420 for why the split exists and why the old enum column stayed.
//
// ⚠️ Nothing here writes engagement_tasks.status. A database trigger rewrites it
// from the chosen status's bucket, so the two can never disagree — which is the
// failure mode of every denormalised-for-convenience column. Setting the bucket
// from application code as well would be two writers for one fact.

import { getServerSupabase } from "@/lib/supabase/server";
import { userDisplayLabel } from "@/lib/db/users";
import { cache } from "react";

export const STATUS_BUCKETS = ["todo", "doing", "done"] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export type TaskStatus = {
  id: string;
  name: string;
  color: string;
  bucket: StatusBucket;
  sort: number;
  /** One line saying what this status MEANS (1590). Null = none offered. */
  description: string | null;
  /** One of the three every firm is seeded with (1420), shown as "Preset".
   *  NOT derived from created_by — see 1590 for why that would drift. */
  isBuiltin: boolean;
  /** Who added it, resolved live so a rename fixes it everywhere. Null for a
   *  preset (nobody did) or an author who has since left the firm. Canopy shows
   *  the same on custom statuses; presets show the Preset badge instead. */
  createdByName: string | null;
  createdAt: string | null;
};

export function toStatusBucket(v: unknown): StatusBucket {
  return (STATUS_BUCKETS as readonly string[]).includes(v as string)
    ? (v as StatusBucket)
    : "todo";
}

/** Before 1420 is applied there is no table — callers get an empty list and
 *  fall back to the three built-in labels rather than a 500. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** An unknown COLUMN, as opposed to a missing table — 1590's description /
 *  is_builtin before it is applied. Matched on codes only (repo rule). */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

const BUCKET_ORDER: Record<StatusBucket, number> = {
  todo: 0,
  doing: 1,
  done: 2,
};

/**
 * Every status the firm has, in board order: unstarted, then under way, then
 * finished, and within each the order the firm put them in.
 *
 * Request-cached on NO arguments — the firm comes from the session, and this is
 * read by the tasks table, the detail panel, the create dialog and the settings
 * page, often on the same request. An object argument would defeat the cache
 * (they compare by identity), which is why there isn't one.
 */
export const listTaskStatuses = cache(
  async function _listTaskStatuses(): Promise<TaskStatus[]> {
    const supabase = await getServerSupabase();
    let { data, error } = await supabase
      .from("task_statuses")
      .select(
        "id, name, color, bucket, sort, description, is_builtin, created_by, created_at",
      );
    // Before 1590 those two columns do not exist. Retry without them rather
    // than 500 a settings page — the reader below coalesces both, so the UI
    // renders exactly as it did before the migration landed.
    if (error && isMissingColumn(error)) {
      ({ data, error } = await supabase
        .from("task_statuses")
        .select("id, name, color, bucket, sort, created_by, created_at"));
    }
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    const rows = ((data ?? []) as Array<Record<string, unknown>>)
      .map((r) => ({
        id: String(r.id),
        name: typeof r.name === "string" ? r.name : "",
        color: typeof r.color === "string" ? r.color : "#64748b",
        bucket: toStatusBucket(r.bucket),
        sort: typeof r.sort === "number" ? r.sort : 0,
        description:
          typeof r.description === "string" && r.description.trim()
            ? r.description
            : null,
        isBuiltin: r.is_builtin === true,
        createdBy: (r.created_by as string | null) ?? null,
        createdByName: null as string | null,
        createdAt: (r.created_at as string | null) ?? null,
      }))
      .filter((s) => s.id && s.name)
      .sort(
        (a, b) =>
          BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
          a.sort - b.sort ||
          a.name.localeCompare(b.name),
      );

    // Resolve author names in ONE query, and live rather than denormalized —
    // unlike a comment, a status is not a record of what somebody said at a
    // moment, so a rename should fix it everywhere.
    const authorIds = [
      ...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x)),
    ];
    if (authorIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, display_name, name, email")
        .in("id", authorIds);
      const byId = new Map<string, string>();
      for (const u of (users ?? []) as Array<{
        id: string;
        display_name: string | null;
        name: string;
        email: string;
      }>) {
        byId.set(u.id, userDisplayLabel(u));
      }
      for (const r of rows) {
        if (r.createdBy) r.createdByName = byId.get(r.createdBy) ?? null;
      }
    }
    return rows.map(({ createdBy: _drop, ...rest }) => rest);
  },
);

export async function createTaskStatus(input: {
  firmId: string;
  name: string;
  color: string;
  bucket: StatusBucket;
  description?: string | null;
  createdBy?: string | null;
}): Promise<{ id: string } | { error: "duplicate" | "failed" }> {
  const supabase = await getServerSupabase();
  // Appended within its bucket. Read the max first rather than keeping a
  // counter: two owners adding at once would otherwise collide, and the order
  // is cosmetic enough that one extra read is the cheaper correctness.
  const { data: existing } = await supabase
    .from("task_statuses")
    .select("sort")
    .eq("firm_id", input.firmId)
    .eq("bucket", input.bucket)
    .order("sort", { ascending: false })
    .limit(1);
  const nextSort =
    (((existing ?? [])[0] as { sort?: number } | undefined)?.sort ?? 0) + 10;

  const row: Record<string, unknown> = {
    firm_id: input.firmId,
    name: input.name,
    color: input.color,
    bucket: input.bucket,
    sort: nextSort,
    created_by: input.createdBy ?? null,
  };
  // Only sent when there IS one, so a pre-1590 database still accepts the
  // insert instead of failing the whole create over an optional line of text.
  if (input.description != null) row.description = input.description;

  let { data, error } = await supabase
    .from("task_statuses")
    .insert(row)
    .select("id")
    .single();
  if (error && isMissingColumn(error)) {
    delete row.description;
    ({ data, error } = await supabase
      .from("task_statuses")
      .insert(row)
      .select("id")
      .single());
  }
  if (error) {
    // 23505 is the (firm_id, lower(name)) unique index — two statuses with one
    // name defeats the entire point, which is that the name is what people say.
    if (error.code === "23505") return { error: "duplicate" };
    console.error("[task-statuses] create failed:", error);
    return { error: "failed" };
  }
  return { id: (data as { id: string }).id };
}

export async function updateTaskStatus(input: {
  id: string;
  firmId: string;
  patch: {
    name?: string;
    color?: string;
    bucket?: StatusBucket;
    description?: string | null;
  };
}): Promise<{ ok: true } | { error: "duplicate" | "failed" }> {
  const supabase = await getServerSupabase();
  const row: Record<string, unknown> = {};
  if (input.patch.name !== undefined) row.name = input.patch.name;
  if (input.patch.color !== undefined) row.color = input.patch.color;
  if (input.patch.bucket !== undefined) row.bucket = input.patch.bucket;
  if (input.patch.description !== undefined) {
    row.description = input.patch.description;
  }
  if (Object.keys(row).length === 0) return { ok: true };

  let { error } = await supabase
    .from("task_statuses")
    .update(row)
    .eq("id", input.id)
    .eq("firm_id", input.firmId);
  // Pre-1590: drop the description and save everything else, so renaming a
  // status still works on a database that is behind the deployment.
  if (error && isMissingColumn(error) && "description" in row) {
    delete row.description;
    if (Object.keys(row).length === 0) return { ok: true };
    ({ error } = await supabase
      .from("task_statuses")
      .update(row)
      .eq("id", input.id)
      .eq("firm_id", input.firmId));
  }
  if (error) {
    if (error.code === "23505") return { error: "duplicate" };
    console.error("[task-statuses] update failed:", error);
    return { error: "failed" };
  }
  return { ok: true };
}

/**
 * Move a status one place up or down WITHIN ITS BUCKET.
 *
 * Bucket-local on purpose: the board is grouped by bucket and ordered inside
 * it, so a status cannot be dragged past the boundary into a group it does not
 * belong to. Changing which bucket it is in is a different, louder action —
 * it reclassifies every task on it.
 *
 * Implemented as a SWAP of two `sort` values rather than a renumber of the
 * whole list: two writes instead of N, and nothing else in the bucket moves,
 * so two owners reordering at once cannot scramble each other's list.
 */
export async function moveTaskStatus(input: {
  id: string;
  firmId: string;
  direction: "up" | "down";
}): Promise<{ ok: true } | { error: "failed" | "at_edge" }> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("task_statuses")
    .select("id, bucket, sort, name")
    .eq("firm_id", input.firmId);
  if (error) {
    console.error("[task-statuses] move read failed:", error);
    return { error: "failed" };
  }
  const all = (data ?? []) as Array<{
    id: string;
    bucket: string;
    sort: number;
    name: string;
  }>;
  const me = all.find((r) => r.id === input.id);
  if (!me) return { error: "failed" };

  // Same order the reader renders, so "up" means what it looked like.
  const siblings = all
    .filter((r) => r.bucket === me.bucket)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const i = siblings.findIndex((r) => r.id === me.id);
  const j = input.direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return { error: "at_edge" };

  const other = siblings[j];
  // Equal sorts would leave the pair ordered by NAME and the swap would look
  // like nothing happened, so give them distinct values before swapping.
  const mine = me.sort === other.sort ? me.sort + (i < j ? -1 : 1) : me.sort;

  const [a, b] = await Promise.all([
    supabase
      .from("task_statuses")
      .update({ sort: other.sort })
      .eq("id", me.id)
      .eq("firm_id", input.firmId),
    supabase
      .from("task_statuses")
      .update({ sort: mine })
      .eq("id", other.id)
      .eq("firm_id", input.firmId),
  ]);
  if (a.error || b.error) {
    console.error("[task-statuses] move failed:", a.error ?? b.error);
    return { error: "failed" };
  }
  return { ok: true };
}

/**
 * Delete a status, moving every task on it to another one first.
 *
 * The move is NOT optional and NOT a null. A task whose status vanished would
 * fall back to its bucket's default label, which reads as a silent
 * reclassification — the row would look like it changed state on its own. The
 * caller names the replacement and the tasks arrive somewhere deliberate.
 */
export async function deleteTaskStatus(input: {
  id: string;
  replacementId: string;
  firmId: string;
}): Promise<{ ok: true } | { error: "last_in_bucket" | "failed" }> {
  const supabase = await getServerSupabase();

  const { data: all } = await supabase
    .from("task_statuses")
    .select("id, bucket")
    .eq("firm_id", input.firmId);
  const rows = (all ?? []) as Array<{ id: string; bucket: string }>;
  const target = rows.find((r) => r.id === input.id);
  if (!target) return { error: "failed" };

  // A bucket with no statuses left is a state nothing could ever be set to —
  // the board would have a hole in it. Refuse rather than repair later.
  if (rows.filter((r) => r.bucket === target.bucket).length <= 1) {
    return { error: "last_in_bucket" };
  }
  const replacement = rows.find((r) => r.id === input.replacementId);
  if (!replacement) return { error: "failed" };

  const { error: moveErr } = await supabase
    .from("engagement_tasks")
    .update({ status_id: input.replacementId })
    .eq("status_id", input.id)
    .eq("firm_id", input.firmId);
  if (moveErr) {
    console.error("[task-statuses] reassign before delete failed:", moveErr);
    return { error: "failed" };
  }

  const { error } = await supabase
    .from("task_statuses")
    .delete()
    .eq("id", input.id)
    .eq("firm_id", input.firmId);
  if (error) {
    console.error("[task-statuses] delete failed:", error);
    return { error: "failed" };
  }
  return { ok: true };
}
