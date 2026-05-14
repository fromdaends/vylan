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
  | { ok: false; error: string; detail?: string };

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
  // Outermost try/catch so the action NEVER rejects on the client.
  // A rejected server action escapes useTransition's boundary and
  // trips the global error.tsx (the user saw a generic 500 page).
  // We want the Switch to revert + show "save_failed" instead.
  try {
    const parsed = AutoRejectSchema.safeParse({
      enabled: formData.get("enabled"),
    });
    if (!parsed.success) return { ok: false, error: "invalid_input" };
    try {
      await updateCurrentFirm({
        auto_reject_unusable_docs: parsed.data.enabled,
      });
    } catch (e) {
      // Most common reason this fires is a missing column in
      // production (migration 0029_ai_usability.sql not yet
      // applied to Supabase). Surface it as a structured error
      // instead of a thrown exception.
      console.error("[setAutoRejectAction] update failed:", e);
      // Surface the underlying DB error message back to the client so
      // the user can paste it into the chat for diagnosis. Safe to
      // expose to the firm owner — it's their own row and the message
      // never includes secrets (PostgREST/Supabase error format).
      const detail =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null
            ? JSON.stringify(e)
            : String(e);
      return { ok: false, error: "update_failed", detail };
    }
    // Intentionally NOT calling revalidatePath here. The /settings
    // page is already `dynamic = "force-dynamic"`, so the next visit
    // re-reads the firm row fresh. A layout-wide revalidate triggers
    // a server-side re-render of the entire app tree as part of the
    // action response — and any throw in that re-render (e.g., a
    // transient storage signed-URL failure inside AppLayout) escapes
    // this action's try/catch and surfaces as a top-level 500 page
    // even though the column update itself succeeded.
    return { ok: true, value: parsed.data.enabled };
  } catch (e) {
    console.error("[setAutoRejectAction] unexpected:", e);
    return { ok: false, error: "update_failed" };
  }
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
