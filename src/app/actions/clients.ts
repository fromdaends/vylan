"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createClient,
  updateClient,
  archiveClient,
  restoreClient,
  bulkCreateClients,
} from "@/lib/db/clients";
import { getPathname } from "@/i18n/navigation";

export type ClientFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

const ClientSchema = z.object({
  type: z.enum(["individual", "business"]),
  display_name: z.string().min(2, "min_2_chars").max(160, "too_long"),
  email: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().email("invalid_email").optional(),
    )
    .optional(),
  phone: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().optional(),
    )
    .optional(),
  locale: z.enum(["fr", "en"]),
  external_ref: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().optional(),
    )
    .optional(),
  notes: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().optional(),
    )
    .optional(),
});

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function createClientAction(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const parsed = ClientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  try {
    await createClient(parsed.data);
  } catch {
    return { error: "create_failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateClientAction(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "missing_id" };

  const parsed = ClientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  try {
    await updateClient(id, parsed.data);
  } catch {
    return { error: "update_failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function archiveClientAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await archiveClient(id);
  revalidatePath("/", "layout");
}

export async function restoreClientAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await restoreClient(id);
  revalidatePath("/", "layout");
}

export type ImportPreviewRow = {
  display_name: string;
  email: string | null;
  phone: string | null;
  type: "individual" | "business";
  locale: "fr" | "en";
  external_ref: string | null;
  notes: string | null;
};

export async function commitImportAction(rows: ImportPreviewRow[]) {
  const created = await bulkCreateClients(rows);
  revalidatePath("/", "layout");
  return created;
}

export async function importAndRedirect(
  rows: ImportPreviewRow[],
  locale: "fr" | "en",
) {
  await bulkCreateClients(rows);
  revalidatePath("/", "layout");
  redirect(getPathname({ locale, href: "/clients" }));
}
