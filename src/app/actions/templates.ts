"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPathname } from "@/i18n/navigation";
import {
  cloneTemplateToFirm,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  BLANK_TEMPLATE_ID,
  type TemplateItem,
} from "@/lib/db/templates";
import { getAutomation, updateAutomation } from "@/lib/db/automations";
import { parseWorkflowDefinition } from "@/lib/workflow/definition";

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
  const created = await cloneTemplateToFirm(BLANK_TEMPLATE_ID, name);
  revalidatePath("/templates/requests");
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

// "Clone to customize" from a built-in's read-only detail page: clone, then
// land in the copy's editor — the same shape as createBlankTemplateAction.
export async function cloneTemplateAndOpenAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const locale =
    (formData.get("__app_locale") === "en" ? "en" : "fr") as "fr" | "en";
  const created = await cloneTemplateToFirm(id);
  revalidatePath("/templates/requests");
  redirect(
    getPathname({
      locale,
      href: { pathname: `/templates/${created.id}` },
    }),
  );
}

export type SaveTemplateWorkflowState =
  | { ok: true; savedBack: boolean }
  | { ok: false; error: "invalid" | "builtin" | "save_failed" };

/**
 * Persist a template's workflow copy (and provenance), optionally saving the
 * edited definition back to the named automation in the library — the
 * founder's two-button prompt. The save-back is best-effort AFTER the
 * template write: the template owning its own copy is the behaviour that
 * matters; the library row is a convenience for future picks.
 */
export async function saveTemplateWorkflowAction(input: {
  templateId: string;
  definition: unknown;
  automationId: string | null;
  saveBackToAutomation?: boolean;
}): Promise<SaveTemplateWorkflowState> {
  const def = parseWorkflowDefinition(input.definition);
  if (!def) return { ok: false, error: "invalid" };

  const tmpl = await getTemplate(input.templateId);
  if (!tmpl) return { ok: false, error: "invalid" };
  // Built-ins are everyone's; RLS refuses the write anyway — say why.
  if (tmpl.firm_id == null) return { ok: false, error: "builtin" };

  try {
    await updateTemplate(input.templateId, {
      workflow: def,
      automation_id: input.automationId ?? null,
    });
  } catch (e) {
    console.error("[templates] workflow save failed:", e);
    return { ok: false, error: "save_failed" };
  }

  let savedBack = false;
  if (input.saveBackToAutomation && input.automationId) {
    try {
      const automation = await getAutomation(input.automationId);
      if (automation && automation.firmId !== null) {
        await updateAutomation(automation.id, { definition: def });
        savedBack = true;
      }
    } catch (e) {
      // The template kept its copy either way; the library just didn't take
      // the update. Surfaced as savedBack=false, never as a failed save.
      console.error("[templates] save-back to automation failed:", e);
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, savedBack };
}
