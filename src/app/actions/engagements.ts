"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createEngagementWithItems,
  sendEngagement,
  cancelEngagement,
  completeEngagement,
  reopenEngagement,
  deleteDraftEngagement,
  getEngagement,
  type CreateEngagementInput,
} from "@/lib/db/engagements";
import { logUserActivity } from "@/lib/db/activity";
import type { TemplateItem, DocType } from "@/lib/db/templates";
import { getClient } from "@/lib/db/clients";
import { getCurrentFirm } from "@/lib/db/firms";
import { buildEngagementInviteEmail, sendEmail } from "@/lib/email";
import { getPathname } from "@/i18n/navigation";

export type CreateEngagementState = {
  ok?: boolean;
  engagementId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

const ItemSchema = z.object({
  label_fr: z.string().min(1),
  label_en: z.string().min(1),
  description_fr: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  doc_type: z.string().min(1),
  required: z.boolean(),
});

// Postgres accepts any 8-4-4-4-12 hex string as uuid; Zod 4's strict .uuid()
// requires RFC 4122 version bits which our seed data doesn't honor. Use the
// permissive format check.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateSchema = z.object({
  client_id: z.string().regex(UUID_REGEX, "invalid_uuid"),
  title: z.string().min(2, "min_2_chars").max(160, "too_long"),
  type: z.enum(["t1", "t2", "bookkeeping", "custom"]),
  due_date: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v && v !== "" ? v : null)),
  items: z.array(ItemSchema).min(0),
});

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function createEngagementAction(payload: {
  client_id: string;
  title: string;
  type: "t1" | "t2" | "bookkeeping" | "custom";
  due_date: string | null;
  items: TemplateItem[];
  send: boolean;
  locale: "fr" | "en";
}): Promise<CreateEngagementState> {
  const parsed = CreateSchema.safeParse({
    client_id: payload.client_id,
    title: payload.title,
    type: payload.type,
    due_date: payload.due_date,
    items: payload.items,
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  let engagementId: string;
  try {
    // The Zod schema validated items as untyped doc_type strings; widen back.
    const items: TemplateItem[] = parsed.data.items.map((i) => ({
      label_fr: i.label_fr,
      label_en: i.label_en,
      description_fr: i.description_fr ?? null,
      description_en: i.description_en ?? null,
      doc_type: i.doc_type as DocType,
      required: i.required,
    }));
    const input: CreateEngagementInput = {
      client_id: parsed.data.client_id,
      title: parsed.data.title,
      type: parsed.data.type,
      due_date: parsed.data.due_date,
      items,
    };
    const created = await createEngagementWithItems(input);
    engagementId = created.id;
    if (payload.send) {
      await sendEngagement(engagementId);
      await deliverInviteEmail(engagementId);
    }
  } catch {
    return { error: "create_failed" };
  }

  revalidatePath("/", "layout");
  redirect(
    getPathname({
      locale: payload.locale,
      href: { pathname: `/engagements/${engagementId}` },
    }),
  );
}

export async function sendEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await sendEngagement(id);
  await deliverInviteEmail(id);
  revalidatePath("/", "layout");
}

async function deliverInviteEmail(engagementId: string): Promise<void> {
  try {
    const engagement = await getEngagement(engagementId);
    if (!engagement || !engagement.magic_token) return;
    const [client, firm] = await Promise.all([
      getClient(engagement.client_id),
      getCurrentFirm(),
    ]);
    if (!client || !firm || !client.email) return;

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const url = `${appUrl}/r/${engagement.magic_token}`;
    const { subject, html, text } = buildEngagementInviteEmail({
      clientName: client.display_name,
      firmName: firm.name,
      engagementTitle: engagement.title,
      url,
      dueDate: engagement.due_date,
      locale: client.locale,
    });
    await sendEmail({ to: client.email, subject, html, text });
  } catch (e) {
    // Email is best-effort; never block the send flow on email failure.
    console.error("[deliverInviteEmail] failed:", e);
  }
}

export async function cancelEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await cancelEngagement(id);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "cancel_engagement", {});
  }
  revalidatePath("/", "layout");
}

export async function completeEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await completeEngagement(id);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "complete_engagement", {});
  }
  revalidatePath("/", "layout");
}

export async function reopenEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await reopenEngagement(id);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "reopen_engagement", {});
  }
  revalidatePath("/", "layout");
}

export async function sendReminderAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const engagement = await getEngagement(id);
  if (!engagement || !engagement.magic_token) return;
  try {
    await deliverInviteEmail(id);
    await logUserActivity(engagement.firm_id, id, "manual_reminder", {});
  } catch (e) {
    console.error("[sendReminderAction] failed:", e);
  }
  revalidatePath("/", "layout");
}

export async function deleteDraftAction(formData: FormData) {
  const id = formData.get("id");
  const locale = (formData.get("__app_locale") === "en" ? "en" : "fr") as
    | "fr"
    | "en";
  if (typeof id !== "string" || !id) return;
  await deleteDraftEngagement(id);
  revalidatePath("/", "layout");
  redirect(getPathname({ locale, href: "/dashboard" }));
}
