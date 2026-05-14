"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { updateCurrentFirm } from "@/lib/db/firms";

export type SettingsState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

// The auto-reject toggle on /settings used to live in a focused Server
// Action here. It moved to POST /api/firm/auto-reject because Server
// Actions auto-trigger an RSC re-render of the surrounding tree, and a
// throw anywhere in that re-render surfaces to the client as an opaque
// "Server Components render" error (digest only) in production. A plain
// fetch keeps the toggle save independent of the page render.

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
