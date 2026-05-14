"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { updateCurrentFirm } from "@/lib/db/firms";

export type SettingsState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

export type AutoRejectActionResult =
  | { ok: true; value: boolean }
  | { ok: false; error: string };

// Focused action for the Discord-style Switch on /settings — only
// touches the one boolean column. Decoupled from the bigger
// SettingsSchema so the Switch can fire on every click without
// having to re-validate name / brand_color / timezone.
const AutoRejectSchema = z.object({
  enabled: z.preprocess(
    (v) => v === "true" || v === "on" || v === true,
    z.boolean(),
  ),
});

export async function setAutoRejectAction(
  formData: FormData,
): Promise<AutoRejectActionResult> {
  const parsed = AutoRejectSchema.safeParse({
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  try {
    await updateCurrentFirm({
      auto_reject_unusable_docs: parsed.data.enabled,
    });
  } catch {
    return { ok: false, error: "update_failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true, value: parsed.data.enabled };
}

export const SettingsSchema = z.object({
  name: z.string().min(2, "min_2_chars").max(120, "too_long"),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalid_color"),
  timezone: z.string().min(2, "required"),
  locale_default: z.enum(["fr", "en"]),
  // HTML checkboxes only send a value when checked (default "on"), so
  // an absent key means "off". Coerce that to a strict boolean so the
  // column update is type-safe.
  auto_reject_unusable_docs: z
    .preprocess(
      (v) => v === "on" || v === "true" || v === true,
      z.boolean(),
    )
    .default(false),
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
