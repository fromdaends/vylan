"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  approveItem,
  reopenItem,
  addItemToEngagement,
  removeItem,
  type NewItemInput,
} from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  addItemSchema,
  pickAddItemFields,
} from "@/lib/engagements/add-item-fields";

export type ItemActionState = {
  ok?: boolean;
  error?: string;
  // The raw server-side reason, surfaced to the UI so a hidden DB/RLS error
  // isn't invisible. (Diagnostic; safe — it's the accountant's own data.)
  detail?: string;
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

// Helper: narrow revalidation to the engagement page that actually
// changed + the dashboard (whose "attention" counts depend on item
// status). Replaces the previous `revalidatePath("/", "layout")` which
// invalidated every cache across the whole app on every approve/reject.
//
// Routes are localized under /[locale], so a bare "/engagements/[id]" never
// matches the real "/fr/engagements/[id]" — the old narrow path silently
// revalidated nothing, so a freshly added item only showed up because of the
// client's router.refresh(). We revalidate every locale's concrete path so the
// server cache is actually busted (the route group "(app)" is not in the URL).
const LOCALES = ["en", "fr"] as const;
function revalidateItemPaths(engagementId: string | undefined) {
  for (const loc of LOCALES) {
    if (engagementId) revalidatePath(`/${loc}/engagements/${engagementId}`);
    revalidatePath(`/${loc}/dashboard`);
  }
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
  revalidateItemPaths(ctx?.engagement_id);
}

// Item reject moved to the stable URL endpoint POST /api/items/[id]/reject
// (deploy-skew-proof), matching the add-item flow.

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
  revalidateItemPaths(ctx?.engagement_id);
}

// Legacy server action (the dialog now POSTs to /api/engagements/[id]/items).
// Kept correct via the shared schema + engagement_id (which the route takes
// from its URL path instead).
const AddItemSchema = addItemSchema.extend({
  engagement_id: z.string().min(1),
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
  // Take whichever label/description the client sent (new or legacy field name).
  const { label, description } = pickAddItemFields(parsed.data);
  if (!label) return { fieldErrors: { label: "required" } };
  const d = parsed.data;
  const input: NewItemInput = {
    engagement_id: d.engagement_id,
    label,
    label_fr: label,
    description,
    description_fr: description,
    doc_type: d.doc_type as NewItemInput["doc_type"],
    required: d.required,
  };
  // The insert is the ONLY thing that decides success. If it fails, surface the
  // real reason. (Previously a bare catch wrapped the insert AND the logging +
  // revalidation, so a hiccup in either of those reported a failed add even
  // when the row was written — and hid why an insert actually failed.)
  let item: Awaited<ReturnType<typeof addItemToEngagement>>;
  try {
    item = await addItemToEngagement(input);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[add_item] insert failed:", detail, e);
    return { error: "add_failed", detail };
  }
  // Best-effort: activity log + cache revalidation must never fail the add.
  try {
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
    revalidateItemPaths(item.engagement_id);
  } catch (e) {
    console.error("[add_item] post-insert step failed (item WAS added):", e);
  }
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
  revalidateItemPaths(ctx?.engagement_id);
}
