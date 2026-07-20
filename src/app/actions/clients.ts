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
  reassignClient,
  canReceiveClientAssignment,
} from "@/lib/db/clients";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { hasActiveTeam } from "@/lib/team/mode";
import { getServerSupabase } from "@/lib/supabase/server";
import { logUserActivity } from "@/lib/db/activity";
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
  // Profile fields (migration 0220). Optional; the "none" sentinel from the
  // form's "Not specified" option (and an empty value) clear the field.
  province: z
    .preprocess(
      (v) =>
        typeof v === "string" && (v.trim() === "" || v === "none")
          ? undefined
          : v,
      z.string().optional(),
    )
    .optional(),
  timezone: z
    .preprocess(
      (v) =>
        typeof v === "string" && (v.trim() === "" || v === "none")
          ? undefined
          : v,
      z.string().optional(),
    )
    .optional(),
  industry: z
    .preprocess(
      (v) =>
        typeof v === "string" && (v.trim() === "" || v === "none")
          ? undefined
          : v,
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

// Reassign a client's owner to another ACTIVE firm member. Any firm member may
// reassign — accountability, NOT access control (clients stay firm-visible),
// mirroring engagement reassignment. Logs `client_reassigned` (engagement_id
// null; client_id in metadata) so it shows up in the /settings/audit trail.
export async function reassignClientAction(
  clientId: string,
  assigneeId: string,
): Promise<{
  ok: boolean;
  error?: "no_session" | "invalid_assignee" | "update_failed";
}> {
  const [user, firm, activeMembers] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    listActiveFirmUsers(),
  ]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (
    !hasActiveTeam({
      teamEnabled: firm.team_enabled === true,
      activeMemberCount: activeMembers.length,
    })
  ) {
    return { ok: false, error: "invalid_assignee" };
  }

  const sb = await getServerSupabase();
  // Target must be an ACTIVE member of the SAME firm.
  const { data: target } = await sb
    .from("users")
    .select("id, firm_id, deactivated_at")
    .eq("id", assigneeId)
    .maybeSingle();
  if (!canReceiveClientAssignment(target, firm.id)) {
    return { ok: false, error: "invalid_assignee" };
  }

  const res = await reassignClient(clientId, assigneeId, firm.id);
  if (!res.ok) return { ok: false, error: "update_failed" };

  await logUserActivity(firm.id, null, "client_reassigned", {
    client_id: clientId,
    to_user_id: assigneeId,
  });
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

// Commit a BOOKKEEPING import (a QuickBooks/Xero customer list staged in a
// client_import_sessions row). Same validated bulk path as the CSV import; the
// session read is RLS-scoped (proving it belongs to the caller's firm and is
// neither consumed nor expired), and the session is consumed on success so a
// double-submit can't create duplicates.
export async function importFromSessionAndRedirect(
  sessionId: string,
  rows: ImportPreviewRow[],
  locale: "fr" | "en",
) {
  const { getClientImportSession, consumeClientImportSession } = await import(
    "@/lib/db/client-import"
  );
  const session = await getClientImportSession(sessionId);
  if (!session) throw new Error("session_gone");
  const validated = validateImportRows(rows);
  await bulkCreateClients(validated);
  await consumeClientImportSession(sessionId);
  revalidatePath("/", "layout");
  redirect(getPathname({ locale, href: "/clients" }));
}
