"use server";

// Server actions for task templates (migration 1570).
//
// Only async exports live here — a `"use server"` module that exports anything
// else fails the production build, and nothing else in the toolchain catches it.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/db/users";
import {
  archiveTaskTemplate,
  createTaskTemplate,
  updateTaskTemplate,
} from "@/lib/db/task-templates";
import {
  isWorthSavingTaskTemplate,
  readTaskTemplatePayload,
} from "@/lib/tasks/template-payload";

// `kind` is a loose string rather than the enum, matching the create-engagement
// action: a kind from a newer bundle must not fail the whole save.
// readTaskTemplatePayload downgrades anything unrecognised to a plain task.
// The client request a task carries — Canopy's "Add client request" inside a
// task template. Bounded, but deliberately loose about content: the reader
// normalises it, and this schema exists to stop an unbounded blob rather than
// to be a second definition of the shape.
const ChecklistSchema = z.object({
  label_en: z.string().trim().max(300).optional(),
  label_fr: z.string().trim().max(300).optional(),
  description_en: z.string().trim().max(2000).nullable().optional(),
  description_fr: z.string().trim().max(2000).nullable().optional(),
  doc_type: z.string().trim().max(100).nullable().optional(),
  required: z.boolean().optional(),
});

const SubtaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

// Canopy's shape: one parent task, with steps and a client request under it.
// `kind` stays a loose string rather than the enum, matching the
// create-engagement action — a kind from a newer bundle must not fail the save,
// and readTaskTemplatePayload downgrades anything unrecognised.
const SaveSchema = z.object({
  /** Present when editing one that already exists; absent when creating. */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  access: z.enum(["team", "private"]),
  kind: z.string().max(60).optional(),
  description: z.string().trim().max(2000).optional(),
  subtasks: z.array(SubtaskSchema).max(100),
  checklist: z.array(ChecklistSchema).max(200).optional(),
});

type Result = {
  ok: boolean;
  needsMigration?: boolean;
  error?: "unauthenticated" | "invalid" | "empty" | "failed";
};

export async function saveTaskTemplateAction(
  input: z.input<typeof SaveSchema>,
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  // Normalised through the SAME reader the pickers use, so what gets stored is
  // exactly what will come back out. Storing the raw post instead would let a
  // template save fields that silently vanish on load.
  const payload = readTaskTemplatePayload({
    kind: parsed.data.kind,
    description: parsed.data.description,
    subtasks: parsed.data.subtasks,
    checklist: parsed.data.checklist,
  });
  if (!isWorthSavingTaskTemplate(payload)) return { ok: false, error: "empty" };

  const res = parsed.data.id
    ? await updateTaskTemplate({
        id: parsed.data.id,
        name: parsed.data.name,
        access: parsed.data.access,
        payload,
      })
    : await createTaskTemplate({
        name: parsed.data.name,
        access: parsed.data.access,
        payload,
      });
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };

  revalidatePath("/templates/tasks");
  revalidatePath("/engagements/new");
  return { ok: true };
}

export async function archiveTaskTemplateAction(id: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "invalid" };
  }

  const res = await archiveTaskTemplate(id);
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };

  revalidatePath("/templates/tasks");
  revalidatePath("/engagements/new");
  return { ok: true };
}
