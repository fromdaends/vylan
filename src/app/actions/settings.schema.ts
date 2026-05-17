// Settings form schema + types. Lives in its own non-"use server" module
// so the Zod runtime object can be re-exported (Next.js 16 forbids any
// non-async-function export from a "use server" file).

import { z } from "zod";

export type SettingsState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

export const SettingsSchema = z.object({
  name: z.string().min(2, "min_2_chars").max(120, "too_long"),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalid_color"),
  // timezone is owned by /settings and saves via POST /api/firm/timezone.
  // The /firm form (which uses this schema) no longer ships a timezone
  // field, so this is optional here; updateCurrentFirm passes through
  // whatever is in the patch.
  timezone: z.string().min(2, "required").optional(),
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
