// Reading a task template's jsonb payload (migration 1570).
//
// ── THE SHAPE, AND WHY IT CHANGED ──────────────────────────────────────────
//
// A task template is ONE PARENT TASK with subtasks and a client request under
// it. That is Canopy's shape (support article 12573386: "Task name (required)",
// "Task description (internal)", then `+ Add` → `Add Subtask` / `Add Client
// Request`), and the founder asked for it explicitly after seeing the two
// side by side.
//
// It was briefly a FLAT LIST of sibling tasks. That was simpler and wrong: a
// "Month-end close" template with five steps put five separate rows on the Work
// list for every client, every month. The parent is what keeps that list
// readable — one row you expand — and it is the only place the whole job's
// facts (its assignee, its due date) have to live.
//
// Vylan's database already supported this: `engagement_tasks.parent_id` and its
// subtask reader have existed since 1370. It was only the TEMPLATE that could
// not express it.
//
// ── THE CONTRACT ───────────────────────────────────────────────────────────
//
// readTaskTemplatePayload is TOTAL. Anything at all can be handed to it — an
// empty object, a payload written by a newer build, a row still in the OLD flat
// shape, null — and it returns a usable value. It never throws. The payload is
// unvalidated by the database on purpose (see 1570's own comment), and it is
// read on the path that draws the Templates page and the engagement builder's
// task picker; a throw there is a 500 on a page that has nothing to do with the
// bad row.

import { toTaskKind, type TaskKind } from "@/lib/db/engagement-tasks";
import type { TemplateChecklistItem } from "@/lib/engagements/template-payload";

/** A step under the parent. Title only — Canopy's subtasks carry more, but
 *  nothing else has a home in Vylan yet and inventing fields the UI cannot set
 *  would be storing lies. */
export type TaskTemplateSubtask = {
  title: string;
};

export type TaskTemplatePayload = {
  /** The parent task's kind. */
  kind: TaskKind;
  /** Canopy's "Task description (internal)" — never shown to a client. */
  description: string;
  /** The steps under the parent, in order. */
  subtasks: TaskTemplateSubtask[];
  /**
   * The client request the parent carries — what the client is asked to send.
   *
   * Copied from a document-request template at edit time, not referenced:
   * Canopy's `Apply template` "populates the fields", and this repo's rule is
   * copy-on-use so that tidying up a document request never rewrites what every
   * saved task template asks for.
   */
  checklist: TemplateChecklistItem[];
};

export function emptyTaskTemplatePayload(): TaskTemplatePayload {
  return { kind: "task", description: "", subtasks: [], checklist: [] };
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Normalise stored jsonb into the shape the app uses.
 *
 * Understands BOTH shapes: the current parent-and-subtasks one, and the flat
 * `{ tasks: [...] }` list that shipped first. A template saved before the
 * change keeps working — its rows become the parent's subtasks, and the first
 * meaningful kind and client request it carried are lifted onto the parent.
 * That is lossy in the sense that a flat template could name several kinds and
 * a parent has one, but it loses no WORK: every titled row survives as a step.
 */
export function readTaskTemplatePayload(raw: unknown): TaskTemplatePayload {
  const root = obj(raw);
  if (!root) return emptyTaskTemplatePayload();

  // ── Legacy flat shape ────────────────────────────────────────────────────
  // Only when there is no `subtasks` key, so a payload carrying both (a
  // half-written row, or one from a build mid-rollout) is read as the CURRENT
  // shape rather than being dragged backwards.
  if (root.subtasks === undefined && Array.isArray(root.tasks)) {
    return upgradeFlatPayload(root.tasks);
  }

  return {
    kind: toTaskKind(root.kind),
    description: str(root.description),
    subtasks: readSubtasks(root.subtasks),
    checklist: readChecklist(root.checklist),
  };
}

/** The flat `{ tasks: [...] }` list, read as a parent with steps under it. */
function upgradeFlatPayload(tasks: unknown[]): TaskTemplatePayload {
  const rows = tasks
    .map((entry) => obj(entry))
    .filter((t): t is Record<string, unknown> => t != null)
    .map((t) => ({
      title: str(t.title),
      kind: toTaskKind(t.kind),
      checklist: readChecklist(t.checklist),
    }))
    .filter((t) => t.title.length > 0);

  // The parent inherits the first row that actually said something about kind
  // or asked the client for anything. Falling back to a plain task is right:
  // "a list of steps" with no stated kind IS a plain task.
  const kindRow = rows.find((r) => r.kind !== "task");
  const requestRow = rows.find((r) => r.checklist.length > 0);

  return {
    kind: kindRow?.kind ?? "task",
    description: "",
    subtasks: rows.map((r) => ({ title: r.title })),
    checklist: requestRow?.checklist ?? [],
  };
}

/**
 * The steps, read defensively.
 *
 * Rows with no usable title are DROPPED rather than kept as blanks: a nameless
 * step is one nobody can identify, and applying the template would put it on
 * real work.
 */
function readSubtasks(raw: unknown): TaskTemplateSubtask[] {
  const out: TaskTemplateSubtask[] = [];
  for (const entry of arr(raw)) {
    // Tolerates a bare string as well as an object — a hand-written payload or
    // an older writer may well have used one, and the title is all we keep.
    if (typeof entry === "string") {
      const title = entry.trim();
      if (title.length > 0) out.push({ title });
      continue;
    }
    const t = obj(entry);
    if (!t) continue;
    const title = str(t.title);
    if (title.length === 0) continue;
    out.push({ title });
  }
  return out;
}

/**
 * The client-request lines, read as defensively as everything else.
 *
 * A line with no label in EITHER language is dropped: it would show as a blank
 * row in the client's portal, which is worse than not asking for it. One
 * language missing is fine and mirrors from the other, matching how the
 * engagement builder already writes checklist rows.
 */
function readChecklist(raw: unknown): TemplateChecklistItem[] {
  const out: TemplateChecklistItem[] = [];
  for (const entry of arr(raw)) {
    const c = obj(entry);
    if (!c) continue;
    const en = str(c.label_en);
    const fr = str(c.label_fr);
    if (en.length === 0 && fr.length === 0) continue;
    out.push({
      label_en: en || fr,
      label_fr: fr || en,
      description_en:
        typeof c.description_en === "string" && c.description_en.length > 0
          ? c.description_en
          : null,
      description_fr:
        typeof c.description_fr === "string" && c.description_fr.length > 0
          ? c.description_fr
          : null,
      doc_type:
        typeof c.doc_type === "string" && c.doc_type.length > 0
          ? c.doc_type
          : null,
      // Anything that is not literally `true` is not required. A stored "true"
      // STRING must not count — the engagement-template reader has the same
      // rule, and the two must not disagree about what "required" means.
      required: c.required === true,
    });
  }
  return out;
}

/**
 * Is this worth storing?
 *
 * A parent with no steps and nothing asked of the client is a name attached to
 * nothing: applying it would create one empty task. A parent with EITHER is
 * real — "Send the engagement letter" needs no subtasks, and a pure document
 * ask needs no steps.
 */
export function isWorthSavingTaskTemplate(p: TaskTemplatePayload): boolean {
  return p.subtasks.length > 0 || p.checklist.length > 0;
}
