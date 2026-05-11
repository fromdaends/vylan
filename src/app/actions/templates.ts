"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  cloneTemplateToFirm,
  updateTemplate,
  deleteTemplate,
  type TemplateItem,
} from "@/lib/db/templates";

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
