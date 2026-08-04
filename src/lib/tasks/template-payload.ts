// Reading a task template's jsonb payload (migration 1570).
//
// THE CONTRACT: readPayload is TOTAL. Anything at all can be handed to it — an
// empty object, a payload written by a newer build, a half-migrated row, null —
// and it returns a usable value. It never throws.
//
// That is not defensiveness for its own sake. The payload is unvalidated by the
// database on purpose (see 1570's own comment), and it is read on the path that
// draws the Templates page and the engagement builder's task picker. A throw
// there is a 500 on a page that has nothing to do with the bad row.

import { toTaskKind, type TaskKind } from "@/lib/db/engagement-tasks";

export type TaskTemplateTask = {
  title: string;
  kind: TaskKind;
};

export type TaskTemplatePayload = {
  tasks: TaskTemplateTask[];
};

export function emptyTaskTemplatePayload(): TaskTemplatePayload {
  return { tasks: [] };
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Normalise stored jsonb into the shape the app uses.
 *
 * Rows with no usable title are DROPPED rather than kept as blanks: a nameless
 * task in a picker is a row nobody can identify, and applying the template
 * would put it on real work.
 *
 * An unrecognised `kind` becomes a plain task rather than being discarded —
 * losing the kind loses an icon; losing the row loses the work.
 */
export function readTaskTemplatePayload(raw: unknown): TaskTemplatePayload {
  const root = obj(raw);
  if (!root) return emptyTaskTemplatePayload();

  const tasks: TaskTemplateTask[] = [];
  for (const entry of arr(root.tasks)) {
    const t = obj(entry);
    if (!t) continue;
    const title = typeof t.title === "string" ? t.title.trim() : "";
    if (title.length === 0) continue;
    tasks.push({ title, kind: toTaskKind(t.kind) });
  }
  return { tasks };
}

/**
 * Is this worth storing?
 *
 * A template with no tasks is a name attached to nothing. Saving one gives the
 * firm a row in their picker that does nothing when applied, which reads as a
 * bug in the picker rather than an empty template.
 */
export function isWorthSavingTaskTemplate(p: TaskTemplatePayload): boolean {
  return p.tasks.length > 0;
}
