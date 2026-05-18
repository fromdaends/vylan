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

// One-field-at-a-time update for the inline editors on the client
// detail page. Each input on that page sends just its own value
// through this so we don't have to round-trip the entire client
// record on every keystroke-debounced blur.
const INLINE_FIELDS = ["email", "phone", "external_ref", "notes"] as const;
type InlineField = (typeof INLINE_FIELDS)[number];

const InlineFieldSchemas: Record<InlineField, z.ZodTypeAny> = {
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.union([z.string().email("invalid_email"), z.null()]),
  ),
  phone: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.union([z.string().max(40, "too_long"), z.null()]),
  ),
  external_ref: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.union([z.string().max(160, "too_long"), z.null()]),
  ),
  notes: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.union([z.string().max(4000, "too_long"), z.null()]),
  ),
};

export type InlineUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateClientFieldAction(
  formData: FormData,
): Promise<InlineUpdateResult> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "missing_id" };

  const field = formData.get("field");
  if (
    typeof field !== "string" ||
    !(INLINE_FIELDS as readonly string[]).includes(field)
  ) {
    return { ok: false, error: "invalid_field" };
  }
  const schema = InlineFieldSchemas[field as InlineField];
  const parsed = schema.safeParse(formData.get("value"));
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message ?? "invalid_value";
    return { ok: false, error: code };
  }

  try {
    await updateClient(id, { [field]: parsed.data });
  } catch {
    return { ok: false, error: "update_failed" };
  }
  // Targeted revalidation — both the detail page and the clients list
  // surface this row.
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
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

// Hard cap on a single CSV import. Anything legitimate is well under this;
// large values let an attacker DoS the firm's clients table.
const MAX_IMPORT_ROWS = 1000;

const ImportRowSchema = z.object({
  display_name: z.string().min(1).max(160),
  email: z.string().email().max(254).nullable(),
  phone: z.string().max(40).nullable(),
  type: z.enum(["individual", "business"]),
  locale: z.enum(["fr", "en"]),
  external_ref: z.string().max(80).nullable(),
  notes: z.string().max(2000).nullable(),
});

// Server-side validation of caller-supplied rows. The preview UI shapes the
// data correctly, but a malicious client can call the server action directly
// with any payload — never trust the shape that arrives here.
function validateImportRows(rows: unknown): ImportPreviewRow[] {
  if (!Array.isArray(rows)) {
    throw new Error("invalid_payload");
  }
  if (rows.length === 0) {
    throw new Error("empty_payload");
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error("too_many_rows");
  }
  const out: ImportPreviewRow[] = [];
  for (const r of rows) {
    const parsed = ImportRowSchema.safeParse(r);
    if (!parsed.success) {
      throw new Error("invalid_row");
    }
    out.push(parsed.data);
  }
  return out;
}

export async function commitImportAction(rows: ImportPreviewRow[]) {
  const validated = validateImportRows(rows);
  const created = await bulkCreateClients(validated);
  revalidatePath("/", "layout");
  return created;
}

export async function importAndRedirect(
  rows: ImportPreviewRow[],
  locale: "fr" | "en",
) {
  const validated = validateImportRows(rows);
  await bulkCreateClients(validated);
  revalidatePath("/", "layout");
  redirect(getPathname({ locale, href: "/clients" }));
}
