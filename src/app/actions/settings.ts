"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { updateCurrentFirm } from "@/lib/db/firms";

export type SettingsState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

const SettingsSchema = z.object({
  name: z.string().min(2, "min_2_chars").max(120, "too_long"),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalid_color"),
  timezone: z.string().min(2, "required"),
  locale_default: z.enum(["fr", "en"]),
});

export async function updateFirmSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = SettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return { fieldErrors };
  }
  try {
    await updateCurrentFirm(parsed.data);
  } catch {
    return { error: "update_failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
