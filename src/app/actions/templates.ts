"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPathname } from "@/i18n/navigation";
import {
  cloneTemplateToFirm,
  updateTemplate,
  deleteTemplate,
  type TemplateItem,
} from "@/lib/db/templates";

// "Personnalisé" / Custom built-in template (seeded in
// 0005_builtin_templates.sql). Intentionally empty — used as the source
// when a firm wants to build a template from scratch.
const BLANK_BUILTIN_ID = "00000000-0000-0000-0000-000000000004";

const ItemSchema = z.object({
  label_fr: z.string().min(1),
  label_en: z.string().min(1),
  description_fr: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  doc_type: z.string().min(1),
  required: z.boolean(),
});

export async function cloneTemplateAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await cloneTemplateToFirm(id);
  revalidatePath("/", "layout");
}

// "Start from scratch" path: clone the empty Custom built-in and jump
// straight into the editor for the new firm-scoped row. Replaces the
// implicit "Clone Personnalisé then click Edit" two-step that wasn't
// obvious to new users.
export async function createBlankTemplateAction(formData: FormData) {
  const locale =
    (formData.get("__app_locale") === "en" ? "en" : "fr") as "fr" | "en";
  const name = locale === "fr" ? "Nouveau modèle" : "New template";
  const created = await cloneTemplateToFirm(BLANK_BUILTIN_ID, name);
  revalidatePath("/templates");
  redirect(
    getPathname({
      locale,
      href: { pathname: `/templates/${created.id}` },
    }),
  );
}

export type UpdateTemplateState = {
  ok?: boolean;
  error?: string;
} | null;

export async function updateTemplateAction(payload: {
  id: string;
  name: string;
  items: TemplateItem[];
}): Promise<UpdateTemplateState> {
  const itemsValid = z.array(ItemSchema).safeParse(payload.items);
  if (!itemsValid.success) {
    return { error: "invalid_items" };
  }
  if (!payload.name.trim()) {
    return { error: "missing_name" };
  }
  try {
    await updateTemplate(payload.id, {
      name: payload.name.trim(),
      items: payload.items,
    });
  } catch {
    return { error: "update_failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteTemplateAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await deleteTemplate(id);
  revalidatePath("/", "layout");
}
