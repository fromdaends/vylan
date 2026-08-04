"use server";

import { notify } from "@/lib/notifications/notify";
import {
  clientName,
  emitEngagementCompleted,
  userName,
} from "@/lib/notifications/emit";
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
  updateEngagementReminderAutomation,
  getEngagement,
  type CreateEngagementInput,
} from "@/lib/db/engagements";
import { listRequestItems } from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import {
  scheduleEngagementReminders,
  cancelEngagementReminders,
  rescheduleEngagementReminders,
} from "@/lib/reminders";
import {
  dispatchInvoiceOnCompletion,
  cancelScheduledInvoice,
} from "@/lib/invoices/schedule";
import { createInvoiceForEngagement } from "@/lib/invoices/create";
import {
  removeStoredInvoiceAttachment,
  storeInvoiceAttachment,
  validateInvoiceAttachment,
  type StoredInvoiceAttachment,
} from "@/lib/invoices/attachment";
import { getFirmLimits } from "@/lib/plan-limits";
import type { TemplateItem, DocType } from "@/lib/db/templates";
import { getClient } from "@/lib/db/clients";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";
import { purgeOneEngagement } from "@/lib/engagements/purge";
import { BULK_ASSIGN_MAX } from "@/lib/engagements/bulk-assign";
import { normalizeHandoffNote } from "@/lib/engagements/handoff-note";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
import { buildEngagementInviteEmail, sendEmail } from "@/lib/email";
import { BUCKET, getBrandingImageUrlForEmail } from "@/lib/storage";
import { getPathname } from "@/i18n/navigation";
import { hasActiveTeam } from "@/lib/team/mode";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";
import { ASSIGNMENT_EMAIL_DELAY_MS } from "@/lib/team/assignment-notify";
import {
  normalizeReminderSettings,
  type ReminderSettings,
} from "@/lib/reminder-settings";
import { applyRepeatChoice } from "@/lib/recurring/enable";
import { parseInvoiceSnapshot } from "@/lib/recurring/invoice-snapshot";

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

const ReminderStepSchema = z.object({
  tone: z.enum(["gentle", "firm", "deadline", "overdue"]),
  enabled: z.boolean(),
  timing: z.enum(["after_send", "after_due"]),
  days: z.number().int().min(1).max(365),
  repeatCount: z.number().int().min(1).max(12),
  withSms: z.boolean(),
  customSubject: z.string().trim().max(160).nullable(),
  customMessage: z.string().trim().max(2_000).nullable(),
});

const ReminderSettingsSchema = z
  .object({
    enabled: z.boolean(),
    steps: z.array(ReminderStepSchema).length(4),
  })
  .superRefine((settings, ctx) => {
    const tones = new Set(settings.steps.map((step) => step.tone));
    if (tones.size !== settings.steps.length) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "duplicate_reminder_tone",
      });
    }
  });

// Postgres accepts any 8-4-4-4-12 hex string as uuid; Zod 4's strict .uuid()
// requires RFC 4122 version bits which our seed data doesn't honor. Use the
// permissive format check.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateSchema = z
  .object({
    client_id: z.string().regex(UUID_REGEX, "invalid_uuid"),
    title: z.string().min(2, "min_2_chars").max(160, "too_long"),
    type: z.enum(["t1", "t2", "bookkeeping", "custom"]),
    due_date: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v && v !== "" ? v : null)),
    // Structured tax year (migration 0900). Optional; null = not set.
    tax_year: z.number().int().min(2000).max(2100).nullable().optional(),
    // "AI Analyze" switch. Optional + defaults true so existing/forgetful callers
    // keep AI on; only an explicit false disables it.
    ai_enabled: z.boolean().optional().default(true),
    // Invoice automation (migration 0590). Optional + defaults 'off'.
    invoice_auto_mode: z
      .enum(["off", "on_completion", "delayed"])
      .optional()
      .default("off"),
    invoice_delay_days: z.number().int().min(1).max(365).nullable().optional(),
    invoice_amount_cents: z
      .number()
      .int()
      .min(50)
      .max(99_999_999)
      .nullable()
      .optional(),
    // Create the invoice immediately at engagement creation (payable right away),
    // as opposed to the deferred on_completion / delayed automation. Mutually
    // exclusive with a non-'off' auto mode (the builder only sends one timing).
    invoice_create_now: z.boolean().optional().default(false),
    // Deliverables lock + description carried onto whichever invoice is created
    // (migration 0610).
    invoice_locks_deliverables: z.boolean().optional().default(false),
    invoice_description: z.string().trim().max(500).nullable().optional(),
    // The priced scope (migration 1450). Optional, so an older client bundle
    // that does not send it still creates engagements exactly as before — the
    // deploy-skew lesson from #0 applies to every server action in this repo.
    service_items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          // Provenance only — the line keeps its own copied values.
          service_id: z.string().uuid().nullable().optional(),
          description: z.string().trim().max(2000).nullable().default(null),
          // Cents. Nullable = "not fixed yet", never 0.
          rate_cents: z.number().int().min(0).max(1_000_000_00).nullable(),
          rate_type: z.enum(["item", "hour"]),
          billing_frequency: z.enum([
            "once",
            "weekly",
            "monthly",
            "quarterly",
            "yearly",
          ]),
          tax_pct: z.number().min(0).max(100).nullable(),
        }),
      )
      .max(50)
      .optional(),
    reminder_settings: ReminderSettingsSchema.optional().transform((value) =>
      normalizeReminderSettings(value),
    ),
    // Recurring series (migration 0770). Optional + defaults 'off'.
    repeat_frequency: z
      .enum(["off", "monthly", "quarterly", "yearly", "custom"])
      .optional()
      .default("off"),
    // Custom schedule ("every N months on day D", migration 0890). Bounds
    // mirror the DB CHECKs. Validated as a pair below.
    repeat_interval_months: z.number().int().min(1).max(24).nullable().optional(),
    repeat_anchor_day: z.number().int().min(1).max(31).nullable().optional(),
    repeat_due_offset_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .nullable()
      .optional(),
    // Invoice recurrence (Phase 4): recreate this engagement's invoice on every
    // spawned occurrence. Only meaningful with repeat on + an invoice configured.
    repeat_invoice_recreate: z.boolean().optional().default(false),
    // Assign the work at creation instead of creating-then-handing-over.
    // Validated against the live active roster below, not just as a uuid:
    // assigned_user_id has no firm-scoped FK, so a well-formed id from
    // another firm would otherwise be accepted.
    assigned_user_id: z.string().uuid().nullable().optional(),
    items: z.array(ItemSchema).min(0),
  })
  // Any invoice (created now OR automated) needs an amount to bill.
  .refine(
    (v) =>
      (v.invoice_auto_mode === "off" && !v.invoice_create_now) ||
      (typeof v.invoice_amount_cents === "number" &&
        v.invoice_amount_cents >= 50),
    { message: "invoice_amount_required", path: ["invoice_amount_cents"] },
  )
  .refine(
    (v) =>
      v.invoice_auto_mode !== "delayed" ||
      (typeof v.invoice_delay_days === "number" && v.invoice_delay_days >= 1),
    { message: "invoice_delay_required", path: ["invoice_delay_days"] },
  );

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

export async function createEngagementAction(
  payload: {
    client_id: string;
    title: string;
    type: "t1" | "t2" | "bookkeeping" | "custom";
    due_date: string | null;
    tax_year?: number | null;
    ai_enabled?: boolean;
    invoice_auto_mode?: "off" | "on_completion" | "delayed";
    invoice_delay_days?: number | null;
    invoice_amount_cents?: number | null;
    invoice_create_now?: boolean;
    invoice_locks_deliverables?: boolean;
    invoice_description?: string | null;
    service_items?: {
      name: string;
      service_id?: string | null;
      description: string | null;
      rate_cents: number | null;
      rate_type: "item" | "hour";
      billing_frequency: "once" | "weekly" | "monthly" | "quarterly" | "yearly";
      tax_pct: number | null;
    }[];
    reminder_settings?: ReminderSettings;
    repeat_frequency?: "off" | "monthly" | "quarterly" | "yearly" | "custom";
    repeat_interval_months?: number | null;
    repeat_anchor_day?: number | null;
    repeat_due_offset_days?: number | null;
    repeat_invoice_recreate?: boolean;
    assigned_user_id?: string | null;
    items: TemplateItem[];
    send: boolean;
    locale: "fr" | "en";
  },
  invoiceAttachment?: File | null,
): Promise<CreateEngagementState> {
  const parsed = CreateSchema.safeParse({
    client_id: payload.client_id,
    title: payload.title,
    type: payload.type,
    due_date: payload.due_date,
    tax_year: payload.tax_year,
    ai_enabled: payload.ai_enabled,
    invoice_auto_mode: payload.invoice_auto_mode,
    invoice_delay_days: payload.invoice_delay_days,
    invoice_amount_cents: payload.invoice_amount_cents,
    invoice_create_now: payload.invoice_create_now,
    invoice_locks_deliverables: payload.invoice_locks_deliverables,
    invoice_description: payload.invoice_description,
    service_items: payload.service_items,
    reminder_settings: payload.reminder_settings,
    repeat_frequency: payload.repeat_frequency,
    repeat_interval_months: payload.repeat_interval_months,
    repeat_anchor_day: payload.repeat_anchor_day,
    repeat_due_offset_days: payload.repeat_due_offset_days,
    repeat_invoice_recreate: payload.repeat_invoice_recreate,
    assigned_user_id: payload.assigned_user_id,
    items: payload.items,
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  // Creating work already assigned to someone. A parseable uuid is NOT proof of
  // a teammate — assigned_user_id has no firm-scoped foreign key, so an id from
  // another firm would otherwise be written straight onto the row and RLS would
  // not object. Anything that isn't a currently-active member of THIS firm falls
  // back to the creator rather than failing the create: the assignee is
  // accountability, and losing a whole engagement over it would be worse.
  let assignedUserId: string | null = null;
  if (parsed.data.assigned_user_id) {
    const activeMembers = await listActiveFirmUsers();
    assignedUserId =
      activeMembers.some((m) => m.id === parsed.data.assigned_user_id)
        ? parsed.data.assigned_user_id
        : null;
  }
  if (invoiceAttachment && invoiceAttachment.size > 0) {
    const validation = validateInvoiceAttachment(invoiceAttachment);
    if (!validation.ok) {
      return { error: `invoice_${validation.error}` };
    }
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
  let storedInvoiceAttachment: StoredInvoiceAttachment | undefined;
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
      tax_year: parsed.data.tax_year ?? null,
      ai_enabled: parsed.data.ai_enabled,
      invoice_auto_mode: parsed.data.invoice_auto_mode,
      // Normalize: only carry the delay/amount that the chosen mode uses, so an
      // 'off' engagement never stores a stray amount and 'on_completion' never
      // stores a delay.
      invoice_delay_days:
        parsed.data.invoice_auto_mode === "delayed"
          ? (parsed.data.invoice_delay_days ?? null)
          : null,
      invoice_amount_cents:
        parsed.data.invoice_auto_mode === "off"
          ? null
          : (parsed.data.invoice_amount_cents ?? null),
      // Lock preference + description are carried onto a LATER (automated)
      // invoice; a "create now" invoice gets them directly below.
      invoice_locks_deliverables: parsed.data.invoice_locks_deliverables,
      invoice_description: parsed.data.invoice_description ?? null,
      service_items: parsed.data.service_items,
      reminder_settings: parsed.data.reminder_settings,
      assigned_user_id: assignedUserId,
      items,
    };
    const created = await createEngagementWithItems(input);
    engagementId = created.id;
    if (invoiceAttachment && invoiceAttachment.size > 0) {
      const stored = await storeInvoiceAttachment(
        engagementId,
        invoiceAttachment,
      );
      if (!stored.ok) {
        return {
          error:
            stored.error === "not_found"
              ? "create_failed"
              : stored.error === "attachment_upload"
                ? "invoice_attachment_upload_error"
                : `invoice_${stored.error}`,
          engagementId,
        };
      }
      storedInvoiceAttachment = stored.attachment;
    }
    if (payload.send) {
      const sent = await sendEngagement(engagementId);
      // Set the workflow stage the same way sendEngagementAction does. Without
      // this, an engagement CREATED-AND-SENT in one step (the /engagements/new
      // flow) keeps stage = null, so its detail header falls back to the "Sent"
      // status pill instead of the "Collecting documents" stage. The
      // detail-page Send button synced; this path was missed when stages
      // were wired in. Best-effort (stage-sync self-heals on the next event).
      await syncEngagementStage(await getServerSupabase(), engagementId);
      await deliverInviteEmail(engagementId);
      if (sent.sent_at) {
        await scheduleEngagementReminders({
          engagementId,
          sentAt: new Date(sent.sent_at),
          dueDate: sent.due_date,
          settings: parsed.data.reminder_settings,
        });
      }
    }
  } catch {
    return { error: "create_failed" };
  }

  // Create the invoice now if the accountant chose "Now" (payable immediately).
  // Best-effort: the engagement is already created, so a failed invoice never
  // fails creation — the accountant can retry from the engagement page. Runs
  // after send() so a just-sent engagement has its portal token for the pay
  // email. The invoice carries the amount / description / lock from the builder.
  if (
    parsed.data.invoice_create_now &&
    typeof parsed.data.invoice_amount_cents === "number"
  ) {
    try {
      const res = await createInvoiceForEngagement({
        engagementId,
        amountCents: parsed.data.invoice_amount_cents,
        description: parsed.data.invoice_description ?? undefined,
        // A just-sent engagement has a portal + token, so email the pay link
        // too. A draft (save-without-send) has no portal yet, so keep it
        // portal-only rather than promising an email that can't go out.
        delivery: payload.send ? "both" : "portal",
        locksDeliverables: parsed.data.invoice_locks_deliverables,
        attachment: storedInvoiceAttachment,
      });
      if (!res.ok) {
        if (storedInvoiceAttachment) {
          await removeStoredInvoiceAttachment(storedInvoiceAttachment);
          storedInvoiceAttachment = undefined;
        }
        console.warn(
          "[createEngagement] create-now invoice skipped:",
          res.reason,
        );
      }
    } catch (e) {
      if (storedInvoiceAttachment) {
        await removeStoredInvoiceAttachment(storedInvoiceAttachment);
      }
      console.error("[createEngagement] create-now invoice failed:", e);
    }
  }

  // Repeat (migration 0770): register the series when the accountant chose a
  // frequency. Best-effort — the engagement already exists, so a failed series
  // create must never fail creation; the state stays visible (the engagement
  // page's Repeat dialog shows "does not repeat") and re-enabling there is the
  // recovery path.
  if (parsed.data.repeat_frequency !== "off") {
    try {
      const [firmForRepeat, userForRepeat, created] = await Promise.all([
        getCurrentFirm(),
        getCurrentUser(),
        getEngagement(engagementId),
      ]);
      if (firmForRepeat && created) {
        // Invoice recurrence (Phase 4): snapshot the builder's own invoice
        // choice. parseInvoiceSnapshot rejects timing 'off' / a missing
        // amount, so the switch quietly stores nothing when there is no
        // invoice to recreate.
        const invoiceSnapshot = parsed.data.repeat_invoice_recreate
          ? parseInvoiceSnapshot({
              timing: parsed.data.invoice_create_now
                ? "at_spawn"
                : parsed.data.invoice_auto_mode,
              delay_days: parsed.data.invoice_delay_days ?? null,
              amount_cents: parsed.data.invoice_amount_cents ?? null,
              locks_deliverables: parsed.data.invoice_locks_deliverables,
              description: parsed.data.invoice_description ?? null,
            })
          : null;
        await applyRepeatChoice({
          engagement: created,
          firmTimezone: firmForRepeat.timezone,
          userId: userForRepeat?.id ?? null,
          frequency: parsed.data.repeat_frequency,
          intervalMonths: parsed.data.repeat_interval_months,
          anchorDay: parsed.data.repeat_anchor_day,
          dueOffsetDays: parsed.data.repeat_due_offset_days ?? 15,
          // Same widening as the engagement items above; a series snapshots
          // the checklist it was created with.
          itemsSnapshot: parsed.data.items.map((i) => ({
            label_fr: i.label_fr,
            label_en: i.label_en,
            description_fr: i.description_fr ?? null,
            description_en: i.description_en ?? null,
            doc_type: i.doc_type as DocType,
            required: i.required,
          })),
          invoice: {
            recreate: parsed.data.repeat_invoice_recreate === true,
            snapshot: invoiceSnapshot,
          },
        });
      }
    } catch (e) {
      console.error("[createEngagement] enable repeat failed:", e);
    }
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
      settings: normalizeReminderSettings(sent.reminder_settings),
    });
  }
  // The engagement now has a workflow position — normally "collecting", though
  // the resolver decides (a signature-only engagement lands elsewhere). This is
  // the transition from no stage (draft) to a real one.
  await syncEngagementStage(await getServerSupabase(), id);
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
  // A cancelled engagement has no workflow position — the resolver returns null
  // and the stage column clears, so its chip falls back to "Cancelled".
  await syncEngagementStage(await getServerSupabase(), id);
  revalidateEngagementPaths(id);
}

export async function completeEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  // EVERYONE can mark work complete. There used to be an owner-sign-off gate
  // here, behind a firm switch, that silently RETURNED without completing and
  // without telling anyone — founder's call is that finishing work is not a
  // permission at all. `me` is still read below: it is the actor on the
  // notification, so the person who clicked is not notified about their click.
  const me = await getCurrentUser();
  await completeEngagement(id);
  await cancelEngagementReminders(id);
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "complete_engagement", {});
    // Tell the rest of the firm. The actor rule means the person who just
    // clicked Complete is not notified about their own click.
    const notifySb = await getServerSupabase();
    await emitEngagementCompleted(
      notifySb,
      {
        firmId: engagement.firm_id,
        engagementId: id,
        engagementTitle: engagement.title,
        clientId: engagement.client_id,
        clientName: await clientName(notifySb, engagement.client_id),
      },
      { actorId: me?.id ?? null },
    );
    // Invoice automation: send now, schedule for later, or nothing, per the
    // engagement's choice. Best-effort — a hiccup here must never block the
    // completion the accountant just did.
    try {
      await dispatchInvoiceOnCompletion(engagement);
    } catch (e) {
      console.error("[completeEngagementAction] invoice dispatch failed:", e);
    }
    // Cloud-storage filing (0900): queue the auto-file pass. Best-effort —
    // the worker no-ops when auto-file is off or nothing is connected, and
    // the ledger makes re-runs double-file-proof.
    try {
      await enqueueJob({
        kind: "file_to_storage",
        payload: { engagementId: id },
        runAfter: new Date(),
      });
    } catch (e) {
      console.error("[completeEngagementAction] filing enqueue failed:", e);
    }
  }
  // AFTER the invoice dispatch, so the resolver sees any invoice it just raised:
  // "invoice on completion" makes the work owed, and the stage settles honestly
  // on awaiting_payment rather than completed. (The reverse rule — stage
  // completed => lifecycle Completed — lives in stage-sync and can't re-fire
  // here: the status is already 'complete'.)
  await syncEngagementStage(await getServerSupabase(), id);
  revalidateEngagementPaths(id);
}

export async function reopenEngagementAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await reopenEngagement(id);
  // Reopened work isn't finished, so drop any pending delayed invoice.
  try {
    await cancelScheduledInvoice(id);
  } catch (e) {
    console.error("[reopenEngagementAction] cancel invoice failed:", e);
  }
  // ...and any queued auto-filing — reopened work shouldn't file moments later.
  try {
    await cancelPendingJobs(
      "file_to_storage",
      (p) => p.engagementId === id,
    );
  } catch (e) {
    console.error("[reopenEngagementAction] cancel filing job failed:", e);
  }
  const engagement = await getEngagement(id);
  if (engagement) {
    await logUserActivity(engagement.firm_id, id, "reopen_engagement", {});
  }
  // Back to live: the stage re-resolves from wherever the work actually stands
  // (usually in_preparation — the deliverables and approvals are still there).
  await syncEngagementStage(await getServerSupabase(), id);
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

export type DeleteForeverResult =
  | { ok: true; purged: true }
  // Not deleted yet: the engagement holds live documents. Nothing is at risk —
  // the purge re-homes them to the client's files — but the dialog says so and
  // asks for an explicit confirm (force: true) before the engagement itself is
  // erased for good.
  | { ok: true; purged: false; fileCount: number }
  | { ok: false };

/**
 * "Delete forever" on a Recently-deleted row: skip the rest of the 30-day
 * window and purge NOW. Owner-only, and ONLY for an engagement that is already
 * soft-deleted — an active engagement can never be hard-deleted in one step.
 *
 * Founder ruling (2026-08-04, after a real data loss): deleting an engagement
 * forever must NOT delete the files it holds — purgeOneEngagement re-homes
 * every live document to the client's files. So the first call no longer asks
 * "would files be lost?" (they can't be); it counts the live files and, when
 * there are any, returns fileCount so the dialog can say the engagement is
 * gone for good but its files are kept and moved to the client. An engagement
 * with no files purges on the first call, same as before.
 */
export async function deleteEngagementForeverAction(input: {
  id: string;
  force?: boolean;
}): Promise<DeleteForeverResult> {
  const id = input.id;
  if (typeof id !== "string" || !id) return { ok: false };
  const user = await getCurrentUser();
  if (!user || !canDeleteEngagements(user.role)) return { ok: false };

  // Prove visibility through the RLS session client before any service-role
  // work (same prove-then-act discipline as the document delete).
  const engagement = await getEngagement(id);
  if (
    !engagement ||
    engagement.firm_id !== user.firm_id ||
    !engagement.deleted_at
  ) {
    return { ok: false };
  }

  const service = getServiceRoleSupabase();

  if (!input.force) {
    // Count the LIVE files the purge will re-home (client uploads + firm
    // deliverables). None are at risk — they move to the client's files — but
    // when there are any, the dialog says so before the engagement itself is
    // erased. Whether a file was also filed to the firm's connected storage
    // no longer matters here: nothing is lost either way.
    let fileCount = 0;
    for (const table of ["uploaded_files", "final_documents"] as const) {
      const { count, error } = await service
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("engagement_id", id)
        .is("deleted_at", null);
      if (error) return { ok: false };
      fileCount += count ?? 0;
    }
    if (fileCount > 0) return { ok: true, purged: false, fileCount };
  }

  try {
    await purgeOneEngagement(
      {
        supabase: service,
        removeStorageObjects: async (paths) => {
          const { error } = await service.storage.from(BUCKET).remove(paths);
          if (error) throw error;
        },
      },
      {
        id: engagement.id,
        firm_id: engagement.firm_id,
        client_id: engagement.client_id,
        title: engagement.title ?? null,
        deleted_at: engagement.deleted_at,
      },
      { type: "user", id: user.id },
    );
  } catch (e) {
    console.error("[deleteEngagementForeverAction] purge failed:", e);
    return { ok: false };
  }
  revalidateEngagementPaths(id);
  return { ok: true, purged: true };
}

// Reassign an engagement's accountability to another ACTIVE firm member. Any
// firm member may reassign — it's accountability, NOT access control (everyone
// still sees every engagement). Logs engagement_reassigned for the feed.
// Toggle an engagement's "Private to me" flag (Team Wave 4). OWNER-ONLY, like the
// per-client control — the engagements_all RLS WITH CHECK is the real gate; this
// gives a clean UX + defense-in-depth. Only meaningful in team mode. Returns
// "unavailable" if 0850 isn't applied yet. Logs engagement_privacy_changed.
export async function setEngagementPrivacyAction(
  engagementId: string,
  isPrivate: boolean,
): Promise<{
  ok: boolean;
  error?: "no_session" | "owner_only" | "not_team" | "unavailable" | "update_failed";
}> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };
  if (
    !hasActiveTeam({ teamEnabled: firm.team_enabled === true, activeMemberCount: 0 })
  ) {
    return { ok: false, error: "not_team" };
  }

  const sb = await getServerSupabase();
  const { error } = await sb
    .from("engagements")
    .update({ is_private: isPrivate })
    .eq("id", engagementId)
    .eq("firm_id", firm.id);
  if (error) {
    if (error.code === "PGRST204" || error.code === "42703") {
      return { ok: false, error: "unavailable" };
    }
    console.error("[engagements] set privacy failed:", error.message);
    return { ok: false, error: "update_failed" };
  }

  await logUserActivity(firm.id, engagementId, "engagement_privacy_changed", {
    is_private: isPrivate,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

// assigneeId null = UNASSIGN. Before this there was no way to take work off
// someone without handing it to somebody else, so a job whose owner had left
// the topic (or the firm) had to be parked on an unrelated teammate.
export async function reassignEngagementAction(
  engagementId: string,
  assigneeId: string | null,
  note?: string,
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
  // Target must be an ACTIVE member of the SAME firm — unless we're clearing
  // the assignee, where there is no target to validate.
  if (assigneeId !== null) {
    const { data: target } = await sb
      .from("users")
      .select("id, firm_id, deactivated_at")
      .eq("id", assigneeId)
      .maybeSingle();
    if (!target || target.firm_id !== firm.id || target.deactivated_at) {
      return { ok: false, error: "invalid_assignee" };
    }
  }

  const { error } = await sb
    .from("engagements")
    .update({
      assigned_user_id: assigneeId,
      // Null the timestamp too: "assigned at 3pm to nobody" is not a fact.
      assigned_at: assigneeId === null ? null : new Date().toISOString(),
    })
    .eq("id", engagementId)
    .eq("firm_id", firm.id);
  if (error) {
    console.error("[engagements] reassign failed:", error.message);
    return { ok: false, error: "update_failed" };
  }

  const handoffNote = normalizeHandoffNote(note);
  await logUserActivity(
    firm.id,
    engagementId,
    assigneeId === null ? "engagement_unassigned" : "engagement_reassigned",
    {
      ...(assigneeId === null ? {} : { to_user_id: assigneeId }),
      ...(handoffNote ? { note: handoffNote } : {}),
    },
  );

  // In-app notification, instantly. suppressEmail because the delayed
  // notify_assignment job below already owns the EMAIL for this event and is
  // smarter about it (it waits 2h and skips anyone who has been active since).
  // Without suppressEmail the assignee would be emailed twice.
  if (assigneeId !== null && user.id !== assigneeId) {
    const { data: engRow } = await sb
      .from("engagements")
      .select("title, client_id")
      .eq("id", engagementId)
      .maybeSingle();
    const eng = engRow as { title: string; client_id: string } | null;
    await notify({
      firmId: firm.id,
      eventKey: "engagement.assigned_to_you",
      entity: { type: "engagement", id: engagementId },
      actorId: user.id,
      engagementId,
      clientId: eng?.client_id ?? null,
      recipients: [assigneeId],
      suppressEmail: true,
      payload: {
        engagement_title: eng?.title ?? null,
        client_name: await clientName(sb, eng?.client_id ?? null),
        actor_name: await userName(sb, user.id),
        note: handoffNote ?? null,
        href: `/engagements/${engagementId}`,
      },
    });
  }

  // Schedule the delayed catch-up EMAIL — only when SOMEONE ELSE assigned the
  // work (never self-assignment) AND the firm hasn't turned assignment emails
  // off (Team settings; defaults on). Supersede any pending catch-up for this
  // engagement (a re-reassignment changes who should be emailed). Best-effort:
  // never fail the reassignment on a queue hiccup. The in-app notification is
  // instant + independent of this (and always shows).
  if (
    assigneeId !== null &&
    user.id !== assigneeId &&
    firm.notify_on_assignment !== false
  ) {
    try {
      await cancelPendingJobs(
        "notify_assignment",
        (p) => p.engagement_id === engagementId,
      );
      await enqueueJob({
        kind: "notify_assignment",
        payload: {
          engagement_id: engagementId,
          assignee_id: assigneeId,
          assigned_by: user.id,
          assigned_at: new Date().toISOString(),
          ...(handoffNote ? { note: handoffNote } : {}),
        },
        runAfter: new Date(Date.now() + ASSIGNMENT_EMAIL_DELAY_MS),
      });
    } catch (e) {
      console.error("[engagements] assignment email enqueue failed:", e);
    }
  }

  revalidateEngagementPaths(engagementId);
  return { ok: true };
}

// Attach a handoff note to an engagement AFTER it was reassigned — the "Add a
// note" affordance on the assignment toast.
//
// Splitting the note from the assignment is the whole point: reassigning used
// to open a dialog every single time, so the 90% of handoffs that need no note
// still cost a modal, while the row-menu path offered no note at all. Now the
// assignment lands instantly and the note is an optional second beat.
//
// APPEND-ONLY. This writes its own activity row rather than editing the
// reassignment's metadata — an audit log that gets rewritten after the fact is
// not an audit log, and "Tyler added a handoff note" is a truthful second
// event. getLatestHandoffNote reads whichever of the two is newest.
//
// NO SECOND NOTIFICATION, deliberately. The assignee was already told the work
// is theirs; pinging them again seconds later would be noise. The note's real
// home is the engagement page, right under "Assigned to" — which is where the
// person holding the work looks, and the reason notes are rendered there at all
// (they used to live only in a notification, so once it was read the
// instructions were gone).
//
// KNOWN LIMIT, stated rather than hidden: the delayed catch-up EMAIL bakes its
// payload at enqueue time, so a note added afterwards does not reach it. The
// note is on the engagement either way.
// Move several engagements to one person in a single action.
//
// The gap this closes: the only bulk path was "Hand over EVERYTHING" on a
// teammate's profile — all-or-nothing, and owner-only. There was no way to move
// eight of someone's twelve files. Karbon has had the tick-rows-and-reassign
// version for years and it is their single biggest advantage on assignment.
//
// NOT owner-gated, matching the single-engagement path: any staff member can
// already reassign any engagement they can see, one at a time, and Karbon's own
// posture is the same (a Standard User can edit work by default; only the
// offboarding sweep is admin-only). Doing ten at once is the same act, not a
// bigger one. The bulk sweep on a teammate's profile stays owner-only because
// THAT one moves clients and recurring schedules too.
//
// RLS does the security. The update runs through the USER's client, so an id
// the caller cannot see is silently not updated rather than rejected — and the
// count that comes back is the truth about what actually moved, which is what
// gets reported.
export async function bulkAssignEngagementsAction(
  engagementIds: string[],
  assigneeId: string | null,
): Promise<{
  ok: boolean;
  moved?: number;
  error?: "no_session" | "invalid_assignee" | "too_many" | "update_failed";
}> {
  const [user, firm, activeMembers] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    listActiveFirmUsers(),
  ]);
  if (!user || !firm) return { ok: false, error: "no_session" };

  const ids = Array.from(new Set(engagementIds.filter(Boolean)));
  if (ids.length === 0) return { ok: true, moved: 0 };
  if (ids.length > BULK_ASSIGN_MAX) return { ok: false, error: "too_many" };

  if (
    !hasActiveTeam({
      teamEnabled: firm.team_enabled === true,
      activeMemberCount: activeMembers.length,
    })
  ) {
    return { ok: false, error: "invalid_assignee" };
  }

  // Target must be an ACTIVE member of THIS firm — assigned_user_id has no
  // firm-scoped foreign key, so a well-formed uuid from another firm would
  // otherwise be accepted. Null is "unassign", which has no target to check.
  if (assigneeId !== null && !activeMembers.some((m) => m.id === assigneeId)) {
    return { ok: false, error: "invalid_assignee" };
  }

  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("engagements")
    .update({
      assigned_user_id: assigneeId,
      // Null the timestamp too: "assigned at 3pm to nobody" is not a fact.
      assigned_at: assigneeId === null ? null : new Date().toISOString(),
    })
    .eq("firm_id", firm.id)
    .in("id", ids)
    .select("id, title, client_id");
  if (error) {
    console.error("[engagements] bulk assign failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  const moved = (data ?? []) as { id: string; title: string; client_id: string }[];
  if (moved.length === 0) return { ok: true, moved: 0 };

  // One activity row PER engagement, not one summary row. A summary would leave
  // each individual engagement's own history with a hole where "who handed this
  // to me?" should be — and that history is the thing an accountant actually
  // opens. Same action string as a single reassign, so the audit log reads
  // identically whether you moved one or ten.
  await Promise.all(
    moved.map((e) =>
      logUserActivity(
        firm.id,
        e.id,
        assigneeId === null ? "engagement_unassigned" : "engagement_reassigned",
        { ...(assigneeId === null ? {} : { to_user_id: assigneeId }), bulk: true },
      ),
    ),
  );

  // Tell the new assignee, once per engagement. suppressEmail for the same
  // reason the single path does it — the delayed catch-up job owns the email
  // and is smarter about it. Skipped entirely on self-assignment and on
  // unassign: nobody needs telling that work left them in a sweep they ran.
  if (assigneeId !== null && assigneeId !== user.id) {
    const actorName = await userName(sb, user.id);
    await Promise.all(
      moved.map(async (e) =>
        notify({
          firmId: firm.id,
          eventKey: "engagement.assigned_to_you",
          entity: { type: "engagement", id: e.id },
          actorId: user.id,
          engagementId: e.id,
          clientId: e.client_id ?? null,
          recipients: [assigneeId],
          suppressEmail: true,
          payload: {
            engagement_title: e.title ?? null,
            client_name: await clientName(sb, e.client_id ?? null),
            actor_name: actorName,
            note: null,
            href: `/engagements/${e.id}`,
          },
        }),
      ),
    );
  }

  for (const e of moved) revalidateEngagementPaths(e.id);
  return { ok: true, moved: moved.length };
}

export async function addHandoffNoteAction(
  engagementId: string,
  note: string,
): Promise<{ ok: boolean; error?: "no_session" | "empty" | "not_found" }> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };

  const clean = normalizeHandoffNote(note);
  if (!clean) return { ok: false, error: "empty" };

  // Confirm the engagement is one this caller can actually see. getEngagement
  // reads through RLS, so a foreign or private id resolves to null and never
  // gets a row written against it.
  const engagement = await getEngagement(engagementId);
  if (!engagement) return { ok: false, error: "not_found" };

  await logUserActivity(firm.id, engagementId, "engagement_handoff_note", {
    note: clean,
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

export type ReminderAutomationEditResult =
  { ok: true } | { ok: false; error: string };

export async function updateReminderAutomationAction(input: {
  engagementId: string;
  settings: ReminderSettings;
  paused: boolean;
}): Promise<ReminderAutomationEditResult> {
  const parsedId = z.string().regex(UUID_REGEX).safeParse(input.engagementId);
  const parsedSettings = ReminderSettingsSchema.safeParse(input.settings);
  if (!parsedId.success || !parsedSettings.success) {
    return { ok: false, error: "invalid" };
  }

  const [user, firm, engagement] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    getEngagement(input.engagementId),
  ]);
  if (!user || !firm || !engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }
  if (engagement.status !== "sent" && engagement.status !== "in_progress") {
    return { ok: false, error: "not_live" };
  }

  const settings = normalizeReminderSettings(parsedSettings.data);
  try {
    await updateEngagementReminderAutomation(
      engagement.id,
      settings,
      input.paused,
    );
    if (input.paused) {
      await cancelEngagementReminders(engagement.id);
    } else if (engagement.sent_at) {
      await rescheduleEngagementReminders({
        engagementId: engagement.id,
        sentAt: new Date(engagement.sent_at),
        dueDate: engagement.due_date,
        settings,
      });
    }
    if (engagement.reminders_paused !== input.paused) {
      await logUserActivity(
        firm.id,
        engagement.id,
        input.paused ? "reminders_paused" : "reminders_resumed",
        {},
      );
    }
    revalidateEngagementPaths(engagement.id);
    return { ok: true };
  } catch (error) {
    console.error("[updateReminderAutomationAction] failed:", error);
    return { ok: false, error: "save_failed" };
  }
}

// Returns { ok } so the header button can pop a success/failure toast — the
// early returns (missing id / no client link) and a delivery exception all
// report ok:false; only a delivered-and-logged reminder is ok:true.
export async function sendReminderAction(
  formData: FormData,
): Promise<{ ok: boolean }> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false };
  const engagement = await getEngagement(id);
  if (!engagement || !engagement.magic_token) return { ok: false };
  try {
    await deliverInviteEmail(id);
    await logUserActivity(engagement.firm_id, id, "manual_reminder", {});
  } catch (e) {
    console.error("[sendReminderAction] failed:", e);
    return { ok: false };
  }
  revalidateEngagementPaths(id);
  return { ok: true };
}

export async function deleteDraftAction(formData: FormData) {
  const id = formData.get("id");
  const locale = (formData.get("__app_locale") === "en" ? "en" : "fr") as
    "fr" | "en";
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
    "fr" | "en";
  if (typeof id !== "string" || !id) return;
  const user = await getCurrentUser();
  if (!user || !canDeleteEngagements(user.role)) return;
  await softDeleteEngagement(id, user.id);
  await cancelEngagementReminders(id);
  await logUserActivity(user.firm_id, id, "engagement_deleted", {});
  revalidateEngagementPaths(id);
  redirect(getPathname({ locale, href: "/dashboard" }));
}
