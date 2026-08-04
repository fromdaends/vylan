// What every kind of task looks like, in ONE place.
//
// The label and the hint for a kind were a hardcoded ternary chain in the table
// AND another in the create dialog. At four kinds that was ugly; at
// ten it is the cohesion rule's own example — two lists that must agree, in two
// files, with nothing to make them.
//
// So: one array, in order, and both screens read it. Adding a kind is one entry
// here, two message keys, and a case in task-kind-icon.tsx — after which it
// appears in the picker, the table, the filter menu and the detail panel at
// once. The GLYPH lives in that component rather than in a field here: the
// React Compiler rejects rendering a component fetched from a lookup, so the
// icons have to be referenced statically anyway.
//
// ── THE SPLIT THAT MATTERS ─────────────────────────────────────────────────
//
// `hasScreen` is not decoration. Three kinds POINT AT a collection keyed by
// engagement_id — they open their own screen and the database keeps them to one
// per job (1370's partial unique index), because a second would drive the same
// rows as the first. Everything else is an ordinary task wearing a name: no
// screen, no collection, no limit.
//
// ⚠️ Setting hasScreen on a new kind does NOT give it a screen. It tells the UI
// the row is clickable and the database to keep it unique. Build the screen
// first or the row leads somewhere blank.

import { type TaskKind } from "@/lib/db/engagement-tasks";

export type TaskKindMeta = {
  kind: TaskKind;
  /** Opens its own screen, and is therefore one-per-job. */
  hasScreen: boolean;
};

export const TASK_KIND_META: readonly TaskKindMeta[] = [
  { kind: "document_collection", hasScreen: true },
  { kind: "signatures", hasScreen: true },
  { kind: "deliverables", hasScreen: true },
  { kind: "tax_return", hasScreen: false },
  { kind: "bookkeeping", hasScreen: false },
  { kind: "notice", hasScreen: false },
  { kind: "review", hasScreen: false },
  { kind: "meeting", hasScreen: false },
  { kind: "filing", hasScreen: false },
  // Last on purpose: "Other" is where you land when none of the above fits, so
  // it belongs at the bottom of the list rather than competing at the top.
  { kind: "task", hasScreen: false },
];

const BY_KIND = new Map(TASK_KIND_META.map((m) => [m.kind, m]));

/** Null for an unrecognised kind — a row written by a newer build still renders
 *  in an older one, it just shows no icon. */
export function taskKindMeta(kind: string): TaskKindMeta | null {
  return BY_KIND.get(kind as TaskKind) ?? null;
}

/** True only for the kinds that actually open something. */
export function taskKindHasScreen(kind: string): boolean {
  return taskKindMeta(kind)?.hasScreen === true;
}

// The message keys are derived rather than listed, so a new kind cannot be
// added here and silently forgotten in the translations — a missing key renders
// as "Engagements.kind_x" ON SCREEN, which is loud enough to catch in one look.
export function taskKindLabelKey(kind: string): string {
  return `kind_${kind}`;
}
export function taskKindHintKey(kind: string): string {
  return `kind_${kind}_hint`;
}
