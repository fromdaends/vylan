// The tasks an engagement is created WITH — pure rules, no I/O.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// Document collection used to be a whole STEP of the engagement wizard, sitting
// between Services and Billing as though "what the client sends you" were a
// peer of "what you are charging". It is not. It is one TASK among the many an
// engagement carries, and Vylan has modelled it that way since 1370 gave
// `engagement_tasks.kind` the value `document_collection`.
//
// The founder, on the old shape: "there shouldn't be a preset documents section
// when creating an engagement. The whole point is that the templates for
// document collection exist purely for that task... it's not a whole section.
// It exists within that task."
//
// So the checklist and its template picker now live INSIDE a task row, and this
// module holds the rules that row has to obey.
//
// ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
//
// Three kinds — document_collection, signatures, deliverables — POINT AT a
// collection keyed by engagement_id, and 1370 keeps them to ONE per engagement
// with a partial unique index. A builder that lets you add a second one is
// offering a row the database will refuse: the insert fails, and because tasks
// are written fail-soft alongside the engagement, it fails SILENTLY. Hence
// `kindTaken` / `availableKinds` — the picker must never show a kind that
// cannot be saved.

import { type TaskKind } from "@/lib/db/engagement-tasks";
import { TASK_KIND_META, taskKindHasScreen } from "@/lib/tasks/kinds";

export type TaskDraft = {
  title: string;
  kind: TaskKind;
  /**
   * The steps under this task — Canopy's subtasks, and what a task template
   * carries.
   *
   * Optional because a task typed by hand in the builder has none, and making
   * every caller pass `[]` to say "no steps" is noise. `engagement_tasks` has
   * had `parent_id` since 1370; this is what finally fills it.
   */
  subtasks?: { title: string }[];
  /** Everybody on it at creation. The founder asked for assignment to happen
   *  WHILE creating rather than as a second pass afterwards. */
  assigneeIds: string[];
};

export function emptyTask(kind: TaskKind = "task"): TaskDraft {
  return { title: "", kind, assigneeIds: [] };
}

/**
 * A row is worth saving once it has a title.
 *
 * Kind is deliberately NOT part of this test: an untitled row whose kind was
 * changed is still an untitled row, and saving it would put a nameless task on
 * the engagement. Whitespace does not count as a name.
 */
export function isMeaningful(task: TaskDraft): boolean {
  return task.title.trim().length > 0;
}

/**
 * What actually gets written: titled rows only, titles trimmed, each person
 * once.
 *
 * Order is preserved because it becomes `order_index` — the sequence the
 * accountant typed is the sequence the work is meant to happen in.
 */
export function meaningfulTasks(tasks: readonly TaskDraft[]): TaskDraft[] {
  return tasks.filter(isMeaningful).map((task) => {
    // Steps get the same treatment as their parent: trimmed, and an untitled
    // one dropped rather than written as a nameless row under a real task.
    const subtasks = (task.subtasks ?? [])
      .map((s) => ({ title: s.title.trim() }))
      .filter((s) => s.title.length > 0);
    return {
      title: task.title.trim(),
      kind: task.kind,
      assigneeIds: [...new Set(task.assigneeIds)],
      ...(subtasks.length > 0 ? { subtasks } : {}),
    };
  });
}

/**
 * Is this one-per-engagement kind already spoken for?
 *
 * `exceptIndex` is the row asking — a row must not consider ITSELF a conflict,
 * or its own kind would vanish from its own dropdown the moment it was picked.
 *
 * Kinds without a screen are never taken: you can have six meetings.
 */
export function kindTaken(
  tasks: readonly TaskDraft[],
  kind: TaskKind,
  exceptIndex?: number,
): boolean {
  if (!taskKindHasScreen(kind)) return false;
  return tasks.some((task, i) => i !== exceptIndex && task.kind === kind);
}

/**
 * The kinds this row may offer — everything except a screen-backed kind that
 * another row already holds.
 *
 * The row's OWN current kind always survives, even in the impossible case where
 * two rows share one: a dropdown whose selected value is not among its options
 * renders blank, which reads as data loss.
 */
export function availableKinds(
  tasks: readonly TaskDraft[],
  forIndex: number,
): TaskKind[] {
  const own = tasks[forIndex]?.kind;
  return TASK_KIND_META.map((meta) => meta.kind).filter(
    (kind) => kind === own || !kindTaken(tasks, kind, forIndex),
  );
}

/**
 * Where the document checklist lives, or -1 when the accountant has not asked
 * the client for anything.
 *
 * -1 is an ordinary answer, not an error: plenty of work (a review, a filing
 * you already hold the papers for) needs nothing from the client.
 */
export function documentCollectionIndex(tasks: readonly TaskDraft[]): number {
  return tasks.findIndex((task) => task.kind === "document_collection");
}

/** Whether the engagement is asking the client for documents at all. */
export function collectsDocuments(tasks: readonly TaskDraft[]): boolean {
  return documentCollectionIndex(tasks) !== -1;
}

export type AppendResult = {
  tasks: TaskDraft[];
  /**
   * Titles whose kind had to change on the way in, because the engagement
   * already holds that one-per-engagement kind.
   *
   * Returned rather than swallowed so the UI can SAY so. A silent downgrade is
   * the worst of the three options: the row is there, it looks right, and the
   * one thing that made it special is gone with no indication.
   */
  downgraded: string[];
};

/**
 * Add a task template to the tasks an engagement is being created with.
 *
 * ── ONE TEMPLATE ADDS ONE TASK ─────────────────────────────────────────────
 *
 * A task template is a PARENT TASK with steps under it, not a bag of siblings.
 * "Month-end close" with five steps must add ONE row to the engagement — the
 * five are subtasks of it. Adding five siblings is what the flat shape did, and
 * it is why the founder asked for Canopy's: ten clients at month-end is ten
 * rows on the Work list, not fifty.
 *
 * ── THE RULE THIS ALSO HAS TO OBEY ─────────────────────────────────────────
 *
 * A template may legitimately be a `document_collection`, `signatures` or
 * `deliverables` — the template editor offers every kind, because a template is
 * not an engagement. But an ENGAGEMENT may hold only one of each (1370's
 * partial unique index), and tasks are written fail-soft: a refused insert is
 * logged and swallowed, so a second would never appear and nothing would say
 * why.
 *
 * So a clashing template lands as a PLAIN TASK rather than being dropped.
 * Dropping loses work the firm wrote down; downgrading loses only its screen,
 * keeps the whole thing visible with its steps intact, and leaves it one
 * dropdown away from being fixed by hand.
 */
export function appendTaskTemplate(
  existing: readonly TaskDraft[],
  template: {
    /** The parent task's name — the template's own name. */
    name: string;
    kind: TaskKind;
    subtasks: readonly { title: string }[];
  },
): AppendResult {
  const title = template.name.trim();
  // Nothing to add. Returning the list unchanged (rather than pushing a
  // nameless row) keeps this safe to call with whatever the picker had.
  if (title.length === 0) return { tasks: [...existing], downgraded: [] };

  const clashes = kindTaken(existing, template.kind);
  const subtasks = template.subtasks
    .map((s) => ({ title: s.title.trim() }))
    .filter((s) => s.title.length > 0);

  const parent: TaskDraft = {
    title,
    kind: clashes ? "task" : template.kind,
    assigneeIds: [],
    // Omitted rather than stored as [] so a task with no steps and one whose
    // steps were all blank read identically.
    ...(subtasks.length > 0 ? { subtasks } : {}),
  };

  return {
    tasks: [...existing, parent],
    downgraded: clashes ? [title] : [],
  };
}
