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
import type { TemplateChecklistItem } from "@/lib/engagements/template-payload";

export type TaskTemplateTask = {
  title: string;
  kind: TaskKind;
  /**
   * A client request carried BY this task — what the client is asked to send.
   *
   * ── WHY IT LIVES HERE AND NOT BESIDE THE TASK TEMPLATE ─────────────────
   *
   * Because that is where Canopy puts it. Their article "Add Client Request
   * Templates to Task Templates" describes editing the TASK template and, at
   * the bottom, `Add` → `Add client request`; the request is attached from
   * inside the task, never from the request's own side.
   *
   * ── WHY IT IS COPIED, NOT REFERENCED ───────────────────────────────────
   *
   * Canopy's `Apply template` populates the fields: "The client request fields
   * will be populated according to the selected template." The article never
   * says the link stays live, and this repo's own rule is copy-on-use, so that
   * editing a catalogue entry never rewrites work someone already agreed to.
   * Storing an id instead would mean a firm tidying up its document requests
   * silently changed what every saved task template asks for.
   *
   * Only meaningful on a `document_collection` row. Present on another kind it
   * is harmless and ignored — dropping it would be a second rule to remember.
   */
  checklist?: TemplateChecklistItem[];
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
    const checklist = readChecklist(t.checklist);
    tasks.push({
      title,
      kind: toTaskKind(t.kind),
      // Omitted rather than stored as [] so a task with no client request and
      // one whose request was emptied read identically — there is no useful
      // difference, and an empty array would render as "0 documents".
      ...(checklist.length > 0 ? { checklist } : {}),
    });
  }
  return { tasks };
}

/**
 * The client-request lines on a task, read as defensively as everything else.
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
    const en = typeof c.label_en === "string" ? c.label_en.trim() : "";
    const fr = typeof c.label_fr === "string" ? c.label_fr.trim() : "";
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
      // Anything that is not literally `true` is not required. A stored
      // "true" string must NOT count — the engagement template reader has the
      // same rule, and the two must not disagree about what "required" means.
      required: c.required === true,
    });
  }
  return out;
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
