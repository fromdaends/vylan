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
  archiveEngagement,
  unarchiveEngagement,
  softDeleteEngagement,
  restoreEngagement,
  setRemindersPaused,
  getEngagement,
  type CreateEngagementInput,
} from "@/lib/db/engagements";
import { listRequestItems } from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import {
  scheduleEngagementReminders,
  cancelEngagementReminders,
} from "@/lib/reminders";
import { getFirmLimits } from "@/lib/plan-limits";
import type { TemplateItem, DocType } from "@/lib/db/templates";
import { getClient } from "@/lib/db/clients";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { getServerSupabase } from "@/lib/supabase/server";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";
import { buildEngagementInviteEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { getPathname } from "@/i18n/navigation";
import { hasActiveTeam } from "@/lib/team/mode";

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
  // "AI Analyze" switch. Optional + defaults true so existing/forgetful callers
  // keep AI on; only an explicit false disables it.
  ai_enabled: z.boolean().optional().default(true),
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

// Narrow revalidation: hit the engagement page that changed plus the
// surfaces that aggregate over engagements (/dashboard worklist + needs-
// attention + what's-new, /clients per-client engagement lists). Replaces the
// previous `revalidatePath("/", "layout")` shotgun.
function revalidateEngagementPaths(id: string | undefined) {
  if (id) revalidatePath(`/engagements/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  // The All-Engagements list + its state sub-pages (Active / Archived /
  // Recently Deleted / …) all live under /engagements.
  revalidatePath("/engagements");
}

export async function createEngagementAction(payload: {
  client_id: string;
  title: string;
  type: "t1" | "t2" | "bookkeeping" | "custom";
  due_date: string | null;
  ai_enabled?: boolean;
  items: TemplateItem[];
  send: boolean;
  locale: "fr" | "en";
}): Promise<CreateEngagementState> {
  const parsed = CreateSchema.safeParse({
    client_id: payload.client_id,
    title: payload.title,
    type: payload.type,
    due_date: payload.due_date,
    ai_enabled: payload.ai_enabled,
    items: payload.items,
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  // Plan limit check — only blocks the *initial send*, not the draft.
  // Draft engagements don't count against the active cap, so the accountant
  // can keep building a draft while they figure out billing.
  if (payload.send) {
    // Can't send an engagement with nothing to collect — the client would
    // land on a portal with zero documents to upload. Saving as a draft is
    // still allowed (send=false), so this only gates the send.
    if (parsed.data.items.length === 0) {
      return { error: "no_documents" };
    }
    const limits = await getFirmLimits();
    if (limits && !limits.canCreateEngagement) {
      return { error: "plan_limit_reached" };
    }
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
      ai_enabled: parsed.data.ai_enabled,
      items,
    };
    const created = await createEngagementWithItems(input);
    engagementId = created.id;
    if (payload.send) {
      const sent = await sendEngagement(engagementId);
      await deliverInviteEmail(engagementId);
      if (sent.sent_at) {
        await scheduleEngagementReminders({
          engagementId,
          sentAt: new Date(sent.sent_at),
          dueDate: sent.due_date,
        });
      }
    }
  } catch {
    return { error: "create_failed" };
  }

  revalidateEngagementPaths(engagementId);
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
  // Backstop for the no-documents rule: an engagement with no requested
  // items has nothing for the client to upload. The detail page disables
  // the Send button in this case, but guard the action too in case it's
  // hit directly.
  const items = await listRequestItems(id);
  if (items.length === 0) return;
  const limits = await getFirmLimits();
  if (limits && !limits.canCreateEngagement) {
    // Soft block — caller's UI should have prevented this anyway, but be safe.
    return;
  }
  const sent = await sendEngagement(id);
  await deliverInviteEmail(id);
  if (sent.sent_at) {
    await scheduleEngagementReminders({
      engagementId: id,
      sentAt: new Date(sent.sent_at),
      dueDate: sent.due_date,
    });
  }
  revalidateEngagementPaths(id);
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
    const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
    const { subject, html, text } = buildEngagementInviteEmail({
      clientName: client.display_name,
      firmName: firm.name,
      firmLogoUrl,
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
  await cancelEngagementReminders(id);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "cancel_engagement", {});
  }
  revalidateEngagementPaths(id);
}

export async function completeEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await completeEngagement(id);
  await cancelEngagementReminders(id);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "complete_engagement", {});
  }
  revalidateEngagementPaths(id);
}

export async function reopenEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await reopenEngagement(id);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "reopen_engagement", {});
  }
  revalidateEngagementPaths(id);
}

// --- Lifecycle actions (Phase 2 data layer; wired into the row context menu
// + "..." button in Phase 3). Archive: owner + staff. Soft-delete / restore:
// OWNER ONLY — the UI hides Delete from staff, and these guards are the
// server-side backstop (RLS still permits the write at the DB level, so the
// application-level role check is the gate). ---

export async function archiveEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const user = await getCurrentUser();
  if (!user) return;
  await archiveEngagement(id, user.id);
  // Archived work shouldn't keep nagging the client.
  await cancelEngagementReminders(id);
  await logUserActivity(user.firm_id, id, "engagement_archived", {});
  revalidateEngagementPaths(id);
}

export async function unarchiveEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const user = await getCurrentUser();
  if (!user) return;
  await unarchiveEngagement(id);
  await logUserActivity(user.firm_id, id, "engagement_unarchived", {});
  revalidateEngagementPaths(id);
}

export async function softDeleteEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const user = await getCurrentUser();
  if (!user || !canDeleteEngagements(user.role)) return;
  await softDeleteEngagement(id, user.id);
  await cancelEngagementReminders(id);
  await logUserActivity(user.firm_id, id, "engagement_deleted", {});
  revalidateEngagementPaths(id);
}

export async function restoreEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const user = await getCurrentUser();
  if (!user || !canDeleteEngagements(user.role)) return;
  await restoreEngagement(id);
  await logUserActivity(user.firm_id, id, "engagement_restored", {});
  revalidateEngagementPaths(id);
}

// Reassign an engagement's accountability to another ACTIVE firm member. Any
// firm member may reassign — it's accountability, NOT access control (everyone
// still sees every engagement). Logs engagement_reassigned for the feed.
export async function reassignEngagementAction(
  engagementId: string,
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
  if (!target || target.firm_id !== firm.id || target.deactivated_at) {
    return { ok: false, error: "invalid_assignee" };
  }

  const { error } = await sb
    .from("engagements")
    .update({
      assigned_user_id: assigneeId,
      assigned_at: new Date().toISOString(),
    })
    .eq("id", engagementId)
    .eq("firm_id", firm.id);
  if (error) {
    console.error("[engagements] reassign failed:", error.message);
    return { ok: false, error: "update_failed" };
  }

  await logUserActivity(firm.id, engagementId, "engagement_reassigned", {
    to_user_id: assigneeId,
  });
  revalidateEngagementPaths(engagementId);
  return { ok: true };
}

export async function toggleRemindersPausedAction(formData: FormData) {
  const id = formData.get("id");
  const next = formData.get("paused") === "1";
  if (typeof id !== "string" || !id) return;
  await setRemindersPaused(id, next);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(
      engagement.firm_id,
      id,
      next ? "reminders_paused" : "reminders_resumed",
      {},
    );
  }
  revalidateEngagementPaths(id);
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
  revalidateEngagementPaths(id);
}

export async function deleteDraftAction(formData: FormData) {
  const id = formData.get("id");
  const locale = (formData.get("__app_locale") === "en" ? "en" : "fr") as
    | "fr"
    | "en";
  if (typeof id !== "string" || !id) return;
  // Drafts go through the same 30-day recoverable soft-delete as everything
  // else — nothing is hard-deleted straight from the UI. Owner-only.
  const user = await getCurrentUser();
  if (!user || !canDeleteEngagements(user.role)) return;
  await softDeleteEngagement(id, user.id);
  await logUserActivity(user.firm_id, id, "engagement_deleted", {});
  revalidateEngagementPaths(id);
  redirect(getPathname({ locale, href: "/dashboard" }));
}

// "Delete" from an engagement's detail page: a recoverable 30-day soft-delete
// (NOT a hard delete — nothing is hard-deleted from the UI; the purge cron is
// the only permanent remove). Owner-only. Stops reminders, logs, then sends the
// user back to the Overview since the engagement has left the active board.
export async function deleteEngagementAction(formData: FormData) {
  const id = formData.get("id");
  const locale = (formData.get("__app_locale") === "en" ? "en" : "fr") as
    | "fr"
    | "en";
  if (typeof id !== "string" || !id) return;
  const user = await getCurrentUser();
  if (!user || !canDeleteEngagements(user.role)) return;
  await softDeleteEngagement(id, user.id);
  await cancelEngagementReminders(id);
  await logUserActivity(user.firm_id, id, "engagement_deleted", {});
  revalidateEngagementPaths(id);
  redirect(getPathname({ locale, href: "/dashboard" }));
}
