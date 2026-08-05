// Task templates (migration 1570) — a named set of tasks, saved for reuse.
//
// Deliberately shaped like src/lib/db/engagement-templates.ts, because they are
// the same kind of object with a different payload: firm-scoped, team-or-private,
// archived rather than deleted, and degrading to an empty list before the
// migration is applied. Where the two differ, it is because they genuinely
// differ — a task template carries no client, no billing and no assignees.

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { isMissingSchema } from "@/lib/db/quickbooks";
import {
  readTaskTemplatePayload,
  type TaskTemplatePayload,
} from "@/lib/tasks/template-payload";

export type TaskTemplateAccess = "team" | "private";

export type TaskTemplate = {
  id: string;
  name: string;
  access: TaskTemplateAccess;
  payload: TaskTemplatePayload;
  createdByUserId: string | null;
  /** When it was last changed (1600). Set by trigger on every update. */
  updatedAt: string | null;
  /** Who changed it (1600). Null renders as the date with no name — honest
   *  about "we did not record who" rather than guessing. */
  updatedByUserId: string | null;
};

type Row = {
  id: string;
  name: string;
  access: string;
  payload: unknown;
  created_by_user_id: string | null;
  updated_at?: string | null;
  updated_by_user_id?: string | null;
};

/**
 * The firm's live task templates.
 *
 * Private ones belonging to other people are filtered by RLS, not here — a
 * private template is invisible at the database, so "private" is a guarantee
 * rather than a label. Degrades to an empty list before 1570 is applied, which
 * is what makes it safe to ship this reader ahead of the migration.
 */
export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("task_templates")
    .select("id, name, access, payload, created_by_user_id, updated_at, updated_by_user_id")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[task-templates] list failed:", error);
    }
    return [];
  }

  return (data as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    access: r.access === "private" ? "private" : "team",
    payload: readTaskTemplatePayload(r.payload),
    createdByUserId: r.created_by_user_id,
    updatedAt: r.updated_at ?? null,
    updatedByUserId: r.updated_by_user_id ?? null,
  }));
}

export async function createTaskTemplate(input: {
  name: string;
  access: TaskTemplateAccess;
  payload: TaskTemplatePayload;
}): Promise<{ ok: true; id: string } | { ok: false; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false };

  const { data, error } = await supabase
    .from("task_templates")
    .insert({
      firm_id: user.firm_id,
      name: input.name,
      access: input.access,
      payload: input.payload,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[task-templates] create failed:", error);
    return { ok: false };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Save changes to an existing template.
 *
 * Separate from create because Canopy's own flow is Options -> Edit on a
 * template that already exists, and because overwriting through the create path
 * would leave the old row behind as a duplicate every time somebody fixed a
 * typo.
 */
export async function updateTaskTemplate(input: {
  id: string;
  name: string;
  access: TaskTemplateAccess;
  payload: TaskTemplatePayload;
}): Promise<{ ok: boolean; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const user = await getCurrentUser();
  const { error } = await supabase
    .from("task_templates")
    .update({
      name: input.name,
      access: input.access,
      payload: input.payload,
      // updated_at is the trigger's (1600). WHO is ours — the database cannot
      // know that. Included only when we have a user, so a service-role write
      // records the change without inventing an author.
      ...(user?.id ? { updated_by_user_id: user.id } : {}),
    })
    .eq("id", input.id);

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[task-templates] update failed:", error);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Retire a template. NOT a delete — the same reasoning as the engagement
 * templates and the service catalogue: it may be the reason a past piece of
 * work looks the way it does.
 */
export async function archiveTaskTemplate(
  id: string,
): Promise<{ ok: boolean; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("task_templates")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[task-templates] archive failed:", error);
    return { ok: false };
  }
  return { ok: true };
}
