"use server";

// Server actions for engagement templates (migration 1500).
//
// Only async exports live here — a `"use server"` module that exports anything
// else fails the production build and nothing else in the toolchain catches it.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/db/users";
import {
  archiveEngagementTemplate,
  createEngagementTemplate,
  updateEngagementTemplate,
} from "@/lib/db/engagement-templates";
import {
  isWorthSaving,
  readPayload,
} from "@/lib/engagements/template-payload";

const ItemSchema = z.object({
  name: z.string().trim().max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  rateCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
  rateType: z.enum(["item", "hour"]).optional(),
  billingFrequency: z
    .enum(["once", "weekly", "monthly", "quarterly", "yearly"])
    .optional(),
  taxPct: z.number().min(0).max(100).nullable().optional(),
});

const ChecklistSchema = z.object({
  label_en: z.string().trim().max(300).optional(),
  label_fr: z.string().trim().max(300).optional(),
  description_en: z.string().trim().max(2000).nullable().optional(),
  description_fr: z.string().trim().max(2000).nullable().optional(),
  doc_type: z.string().trim().max(100).nullable().optional(),
  required: z.boolean().optional(),
});

// The opaque steps are passed through unread. Bounded so a malformed client
// cannot post an unbounded blob into the row, but deliberately not shaped —
// this file must not need editing every time the invoice step grows a field.
const OpaqueSchema = z.record(z.string(), z.unknown()).nullable().optional();

const PayloadSchema = z.object({
  title: z.string().trim().max(300).optional(),
  type: z.string().trim().max(50).nullable().optional(),
  // Canopy's engagement period. A RULE, never a resolved date — a template
  // reused next season must not carry last season's start.
  periodStartsOn: z.enum(["acceptance", "custom"]).optional(),
  periodMonths: z.number().int().min(1).max(120).nullable().optional(),
  introMessage: z.string().trim().max(5000).optional(),
  isDraft: z.boolean().optional(),
  // Canopy's three Introduction rows.
  welcomeEnabled: z.boolean().optional(),
  videoEnabled: z.boolean().optional(),
  videoUrl: z.string().trim().max(500).optional(),
  // Storage paths, written by uploadTemplateAssetAction. Bounded; the path is
  // built server-side so this only has to stop an oversized blob.
  videoPath: z.string().trim().max(500).optional(),
  videoFileName: z.string().trim().max(300).optional(),
  documentPath: z.string().trim().max(500).optional(),
  documentEnabled: z.boolean().optional(),
  documentName: z.string().trim().max(300).optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  // Terms.
  termsEnabled: z.boolean().optional(),
  termsText: z.string().trim().max(20000).optional(),
  // Signatures. A template names ROLES, not people — see the payload reader.
  clientSigns: z.boolean().optional(),
  additionalSignerLabels: z.array(z.string().trim().max(120)).max(10).optional(),
  firmCountersigns: z.boolean().optional(),
  depositCents: z.number().int().min(0).max(99_999_999).nullable().optional(),
  items: z.array(ItemSchema).max(50).optional(),
  checklist: z.array(ChecklistSchema).max(200).optional(),
  // Canopy's billing blocks. Bounded, but deliberately loose about the enum
  // values — readPayload repairs a type/timing mismatch rather than dropping
  // the block, and this schema exists to stop an unbounded blob, not to be a
  // second definition of the shape.
  billingBlocks: z
    .array(
      z.object({
        billingType: z.string().max(30).optional(),
        timing: z.string().max(40).optional(),
        frequency: z.string().max(30).optional(),
        combineItems: z.boolean().optional(),
        clientNote: z.string().trim().max(2000).optional(),
        items: z.array(ItemSchema).max(50).optional(),
      }),
    )
    .max(20)
    .optional(),
  priceVisibility: z
    .object({
      itemizedPrice: z.boolean().optional(),
      blockTotals: z.boolean().optional(),
      total: z.boolean().optional(),
    })
    .optional(),
  invoice: OpaqueSchema,
  reminders: OpaqueSchema,
  repeat: OpaqueSchema,
});

const SaveSchema = z.object({
  /** Present when editing one that already exists; absent when creating. */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  access: z.enum(["team", "private"]),
  payload: PayloadSchema,
  /**
   * Canopy's "Save draft" — store incomplete work.
   *
   * Skips the worth-saving check, which exists to stop an EMPTY finished
   * template sitting in the picker forever. A draft is allowed to be empty;
   * being half-written is the whole point. It still needs a name, because a
   * draft you cannot find again is not saved in any useful sense — and the
   * schema above already requires one.
   */
  allowIncomplete: z.boolean().optional(),
});

type Result = {
  ok: boolean;
  needsMigration?: boolean;
  error?: "unauthenticated" | "invalid" | "empty" | "failed";
};

export async function saveEngagementAsTemplateAction(
  input: z.input<typeof SaveSchema>,
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  // Normalised through the SAME reader the picker uses, so what gets stored is
  // exactly what will come back out. Storing the raw post instead would let a
  // template save fields that silently vanish on load.
  const payload = readPayload(parsed.data.payload);
  if (!parsed.data.allowIncomplete && !isWorthSaving(payload)) {
    return { ok: false, error: "empty" };
  }

  const res = parsed.data.id
    ? await updateEngagementTemplate({
        id: parsed.data.id,
        name: parsed.data.name,
        access: parsed.data.access,
        payload,
      })
    : await createEngagementTemplate({
        name: parsed.data.name,
        access: parsed.data.access,
        payload,
      });
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };

  revalidatePath("/engagements/new");
  revalidatePath("/templates/engagements");
  return { ok: true };
}

export async function archiveEngagementTemplateAction(
  id: string,
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "invalid" };
  }

  const res = await archiveEngagementTemplate(id);
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };

  revalidatePath("/engagements/new");
  revalidatePath("/templates/engagements");
  return { ok: true };
}
