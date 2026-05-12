"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  approveItem,
  rejectItem,
  reopenItem,
  addItemToEngagement,
  removeItem,
  type NewItemInput,
} from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import { getServerSupabase } from "@/lib/supabase/server";

export type ItemActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

async function getEngagementFirm(
  itemId: string,
): Promise<{ engagement_id: string; firm_id: string } | null> {
  const sb = await getServerSupabase();
  const { data } = await sb
    .from("request_items")
    .select("engagement_id, engagements!inner(firm_id)")
    .eq("id", itemId)
    .maybeSingle();
  if (!data) return null;
  type Row = {
    engagement_id: string;
    engagements: { firm_id: string } | { firm_id: string }[] | null;
  };
  const e = (data as Row).engagements;
  if (!e) return null;
  const firm_id = Array.isArray(e) ? e[0]?.firm_id : e.firm_id;
  if (!firm_id) return null;
  return { engagement_id: (data as Row).engagement_id, firm_id };
}

export async function approveItemAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const ctx = await getEngagementFirm(id);
  await approveItem(id);
  if (ctx) {
    await logUserActivity(ctx.firm_id, ctx.engagement_id, "approve_item", {
      item_id: id,
    });
  }
  revalidatePath("/", "layout");
}

const RejectSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(2, "min_2_chars").max(500, "too_long"),
});

export async function rejectItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const parsed = RejectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }
  const ctx = await getEngagementFirm(parsed.data.id);
  await rejectItem(parsed.data.id, parsed.data.reason);
  if (ctx) {
    await logUserActivity(ctx.firm_id, ctx.engagement_id, "reject_item", {
      item_id: parsed.data.id,
      reason: parsed.data.reason,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reopenItemAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const ctx = await getEngagementFirm(id);
  await reopenItem(id);
  if (ctx) {
    await logUserActivity(ctx.firm_id, ctx.engagement_id, "reopen_item", {
      item_id: id,
    });
  }
  revalidatePath("/", "layout");
}

const AddItemSchema = z.object({
  engagement_id: z.string().min(1),
  label_fr: z.string().min(1).max(200),
  label_en: z.string().min(1).max(200),
  description_fr: z.string().max(500).optional().nullable(),
  doc_type: z.string().min(1),
  required: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.undefined()])
    .transform((v) => v === "on" || v === "true"),
});

export async function addItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const entries = Object.fromEntries(formData);
  const parsed = AddItemSchema.safeParse(entries);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }
  const input: NewItemInput = {
    engagement_id: parsed.data.engagement_id,
    label: parsed.data.label_en,
    label_fr: parsed.data.label_fr,
    description: null,
    description_fr: parsed.data.description_fr ?? null,
    doc_type: parsed.data.doc_type as NewItemInput["doc_type"],
    required: parsed.data.required,
  };
  try {
    const item = await addItemToEngagement(input);
    const sb = await getServerSupabase();
    const { data: e } = await sb
      .from("engagements")
      .select("firm_id")
      .eq("id", item.engagement_id)
      .single();
    if (e) {
      await logUserActivity(e.firm_id, item.engagement_id, "add_item", {
        item_id: item.id,
        label: input.label_fr,
      });
    }
  } catch {
    return { error: "add_failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeItemAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const ctx = await getEngagementFirm(id);
  await removeItem(id);
  if (ctx) {
    await logUserActivity(ctx.firm_id, ctx.engagement_id, "remove_item", {
      item_id: id,
    });
  }
  revalidatePath("/", "layout");
}
