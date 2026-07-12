// Collapse the single/legacy label + description fields a client may post into
// one of each. Version-proof: a client bundle cached from any recent deploy
// sends SOME of these names (current `label`/`description`, or legacy
// `label_fr`/`label_en`/`description_fr`) — taking whichever is present means
// the add never fails just because the browser and server are a version apart.
//
// Pure + framework-free so it's unit-tested directly. It lives here (not in the
// "use server" actions file, which may only export async server actions).
import { z } from "zod";

// Shared validation for adding a checklist item, used by BOTH the API route and
// the (legacy) server action so they can't drift.
//
// CRITICAL: `required` MUST be `.optional()`. It comes from a checkbox — when
// UNCHECKED the browser sends NO `required` field at all, so the key is absent
// from FormData. A non-optional schema rejects an absent key ("expected
// nonoptional, received undefined") → the whole add fails unless the box is
// ticked. This was the real "you have to check Required to add" bug.
export const addItemSchema = z.object({
  // label / legacy label_fr|label_en (older cached clients) — picked downstream.
  label: z.string().max(200).optional().nullable(),
  label_fr: z.string().max(200).optional().nullable(),
  label_en: z.string().max(200).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  description_fr: z.string().max(500).optional().nullable(),
  doc_type: z.string().min(1),
  required: z
    .union([z.literal("on"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
  // Per-item custom rules for the AI document checker (migration 0580).
  // Optional free text; absent/blank means no custom rules.
  ai_rules: z.string().max(2000).optional().nullable(),
});

export function pickAddItemFields(d: {
  label?: string | null;
  label_fr?: string | null;
  label_en?: string | null;
  description?: string | null;
  description_fr?: string | null;
}): { label: string; description: string | null } {
  const label = (d.label || d.label_fr || d.label_en || "").trim();
  const description = (d.description || d.description_fr || "").trim() || null;
  return { label, description };
}
