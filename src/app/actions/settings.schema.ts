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
  // Owned by the Documents tab, which saves via POST /api/firm/auto-reject —
  // same arrangement as timezone above. The form using THIS schema renders no
  // auto-reject control, so the key must stay absent from the parsed output:
  // updateFirmSettings passes the whole parsed object to updateCurrentFirm,
  // which writes every key it is handed.
  //
  // MUST NOT be .default(false). A default MATERIALISES the key even when the
  // form never sent it, so saving the firm name would hand over
  // `auto_reject_unusable_docs: false` and silently switch the setting off.
  // .optional() short-circuits ahead of the preprocess and drops the key
  // entirely, while still coercing the HTML checkbox's "on" if a form ever
  // does ship one.
  auto_reject_unusable_docs: z
    .preprocess(
      (v) => v === "on" || v === "true" || v === true,
      z.boolean(),
    )
    .optional(),
});
