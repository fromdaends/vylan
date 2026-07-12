// The engagement chat's action engine (phase 3).
//
// Two strictly separated halves:
//
//  buildActionProposal — runs while the MODEL is talking. Validates the
//    model's inputs against the engagement's real state and enriches them
//    into the human-facing snapshot the confirm card shows. NO side effects.
//
//  executeAction — runs ONLY from POST /api/engagement-chat/confirm after a
//    human pressed Confirm on the card. Performs the side effect through the
//    SAME lib functions the normal Vylan buttons use, with the CALLER's
//    RLS-scoped session client (so row scoping + attribution match a manual
//    click), then logs to activity_log with a via:"assistant" marker.
//
// The model never holds a path to executeAction: its tools only reach
// buildActionProposal, and the confirm endpoint requires the row's
// single-use token, which is handed to the browser alone.

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approveFile, rejectFile } from "@/lib/db/file-review";
import {
  addItemToEngagement,
  removeItem,
  updateRequestItem,
} from "@/lib/db/request-items";
import { updateEngagementDueDate } from "@/lib/db/engagements";
import { rescheduleOverdueReminder } from "@/lib/reminders";
import { logUserActivity } from "@/lib/db/activity";
import { listActiveFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { buildEngagementInviteEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { getClient } from "@/lib/db/clients";
import type { DocType } from "@/lib/db/templates";
import {
  type ActionErrorCode,
  type ActionPayloads,
  type AnyActionPayload,
  type ChatActionType,
} from "./action-schemas";
import { fetchChatEngagement, type ChatEngagementRow } from "./data";
import { REMINDER_COOLDOWN_HOURS } from "./config";

const LOCALES = ["en", "fr"] as const;
function revalidateEngagement(engagementId: string) {
  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/engagements/${engagementId}`);
    revalidatePath(`/${loc}/dashboard`);
  }
}

type FileRow = {
  id: string;
  request_item_id: string | null;
  display_name: string | null;
  original_filename: string | null;
  review_status: "pending" | "approved" | "rejected" | null;
};

async function fetchFile(
  sb: SupabaseClient,
  engagementId: string,
  fileId: string,
): Promise<FileRow | null> {
  const res = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, display_name, original_filename, review_status",
    )
    .eq("id", fileId)
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as FileRow) ?? null;
}

type ItemRow = {
  id: string;
  label: string;
  kind: "collection" | "signature" | null;
};

async function fetchItem(
  sb: SupabaseClient,
  engagementId: string,
  itemId: string,
): Promise<ItemRow | null> {
  const res = await sb
    .from("request_items")
    .select("id, label, kind")
    .eq("id", itemId)
    .eq("engagement_id", engagementId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as ItemRow) ?? null;
}

async function itemLabelForFile(
  sb: SupabaseClient,
  engagementId: string,
  requestItemId: string | null,
): Promise<string | null> {
  if (!requestItemId) return null;
  const item = await fetchItem(sb, engagementId, requestItemId);
  return item?.label ?? null;
}

function fileName(row: FileRow): string {
  return row.display_name || row.original_filename || "(sans nom)";
}

// A manual reminder (button or chat) within the cooldown window blocks a new
// one — checked at proposal AND at execution (state can change in between).
async function lastManualReminderAt(
  sb: SupabaseClient,
  engagementId: string,
): Promise<string | null> {
  const since = new Date(
    Date.now() - REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const res = await sb
    .from("activity_log")
    .select("created_at")
    .eq("engagement_id", engagementId)
    .eq("action", "manual_reminder")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (res.error) throw res.error;
  return (res.data ?? [])[0]?.created_at ?? null;
}

// ---------------------------------------------------------------------------
// Proposal building (no side effects)
// ---------------------------------------------------------------------------

export type ProposalResult =
  | { ok: true; payload: AnyActionPayload }
  | { ok: false; error: string };

export async function buildActionProposal(
  type: ChatActionType,
  input: Record<string, unknown>,
  ctx: { sb: SupabaseClient; engagementId: string },
): Promise<ProposalResult> {
  const { sb, engagementId } = ctx;
  switch (type) {
    case "approve_document": {
      const file = await fetchFile(sb, engagementId, input.file_id as string);
      if (!file) return { ok: false, error: "No such document in this engagement." };
      if (file.review_status === "approved") {
        return { ok: false, error: "That document is already approved." };
      }
      const payload: ActionPayloads["approve_document"] = {
        file_id: file.id,
        file_name: fileName(file),
        item_label: await itemLabelForFile(sb, engagementId, file.request_item_id),
        prior_status: file.review_status,
      };
      return { ok: true, payload };
    }
    case "reject_document": {
      const file = await fetchFile(sb, engagementId, input.file_id as string);
      if (!file) return { ok: false, error: "No such document in this engagement." };
      if (file.review_status === "rejected") {
        return { ok: false, error: "That document is already rejected." };
      }
      const payload: ActionPayloads["reject_document"] = {
        file_id: file.id,
        file_name: fileName(file),
        item_label: await itemLabelForFile(sb, engagementId, file.request_item_id),
        reason: input.reason as string,
        prior_status: file.review_status,
      };
      return { ok: true, payload };
    }
    case "send_reminder": {
      const engagement = await fetchChatEngagement(sb, engagementId);
      if (!engagement) return { ok: false, error: "Engagement not found." };
      if (!engagement.sent_at || !["sent", "in_progress"].includes(engagement.status)) {
        return {
          ok: false,
          error: "Reminders only apply to a live (sent, not completed) engagement.",
        };
      }
      const recent = await lastManualReminderAt(sb, engagementId);
      if (recent) {
        return {
          ok: false,
          error: `A manual reminder was already sent in the last ${REMINDER_COOLDOWN_HOURS}h — don't spam the client.`,
        };
      }
      const client = await getClient(engagement.client_id);
      if (!client?.email) {
        return { ok: false, error: "The client has no email address on file." };
      }
      const payload: ActionPayloads["send_reminder"] = {
        client_name: client.display_name ?? null,
        client_email: client.email,
      };
      return { ok: true, payload };
    }
    case "add_checklist_item": {
      const payload: ActionPayloads["add_checklist_item"] = {
        label: input.label as string,
        doc_type: (input.doc_type as string | undefined) ?? "other",
        required: (input.required as boolean | undefined) ?? true,
      };
      return { ok: true, payload };
    }
    case "edit_checklist_item": {
      const item = await fetchItem(sb, engagementId, input.item_id as string);
      if (!item) return { ok: false, error: "No such checklist item in this engagement." };
      if (item.kind === "signature") {
        return {
          ok: false,
          error: "Signature items can't be edited from the chat — the signature flow owns them.",
        };
      }
      const payload: ActionPayloads["edit_checklist_item"] = {
        item_id: item.id,
        item_label: item.label,
        changes: {
          ...(input.new_label !== undefined
            ? { new_label: input.new_label as string }
            : {}),
          ...(input.required !== undefined
            ? { required: input.required as boolean }
            : {}),
          ...(input.doc_type !== undefined
            ? { doc_type: input.doc_type as string }
            : {}),
        },
      };
      return { ok: true, payload };
    }
    case "remove_checklist_item": {
      const item = await fetchItem(sb, engagementId, input.item_id as string);
      if (!item) return { ok: false, error: "No such checklist item in this engagement." };
      if (item.kind === "signature") {
        return {
          ok: false,
          error: "Signature items can't be removed from the chat — the signature flow owns them.",
        };
      }
      const filesRes = await sb
        .from("uploaded_files")
        .select("id", { count: "exact", head: true })
        .eq("request_item_id", item.id);
      if (filesRes.error) throw filesRes.error;
      const payload: ActionPayloads["remove_checklist_item"] = {
        item_id: item.id,
        item_label: item.label,
        files_count: filesRes.count ?? 0,
      };
      return { ok: true, payload };
    }
    case "change_due_date": {
      const engagement = await fetchChatEngagement(sb, engagementId);
      if (!engagement) return { ok: false, error: "Engagement not found." };
      const to = (input.due_date as string | null) ?? null;
      if ((engagement.due_date ?? null) === to) {
        return { ok: false, error: "The due date already has that value." };
      }
      const payload: ActionPayloads["change_due_date"] = {
        from: engagement.due_date ?? null,
        to,
      };
      return { ok: true, payload };
    }
    case "change_assignee": {
      const [engagement, members] = await Promise.all([
        fetchChatEngagement(sb, engagementId),
        listActiveFirmUsers(),
      ]);
      if (!engagement) return { ok: false, error: "Engagement not found." };
      const target = members.find((m) => m.id === (input.user_id as string));
      if (!target) {
        return {
          ok: false,
          error: "That user isn't an active member of the firm. Use list_team_members for valid targets.",
        };
      }
      if (engagement.assigned_user_id === target.id) {
        return { ok: false, error: "The engagement is already assigned to that member." };
      }
      const from = members.find((m) => m.id === engagement.assigned_user_id);
      const payload: ActionPayloads["change_assignee"] = {
        user_id: target.id,
        member_name: userDisplayLabel(target),
        from_name: from ? userDisplayLabel(from) : null,
      };
      return { ok: true, payload };
    }
  }
}

// ---------------------------------------------------------------------------
// Execution (confirm endpoint ONLY)
// ---------------------------------------------------------------------------

export type ExecuteResult =
  | { ok: true }
  | { ok: false; code: ActionErrorCode };

export type ExecuteContext = {
  // The CONFIRMER's RLS session client + identity (may differ from the
  // proposer — any active firm member may confirm, same as doing it by hand).
  sb: SupabaseClient;
  userId: string;
  firmId: string;
  engagementId: string;
};

export async function executeAction(
  type: ChatActionType,
  payload: AnyActionPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  try {
    switch (type) {
      case "approve_document": {
        const p = payload as ActionPayloads["approve_document"];
        const file = await fetchFile(ctx.sb, ctx.engagementId, p.file_id);
        if (!file) return { ok: false, code: "state_changed" };
        // A teammate changed the file's review status since the card was
        // proposed — don't silently overwrite their decision.
        if ((file.review_status ?? null) !== (p.prior_status ?? null)) {
          return { ok: false, code: "state_changed" };
        }
        await approveFile(ctx.sb, p.file_id, ctx.userId);
        await logUserActivity(ctx.firmId, ctx.engagementId, "approve_item", {
          item_id: file.request_item_id ?? undefined,
          file_id: p.file_id,
          via: "assistant",
        });
        break;
      }
      case "reject_document": {
        const p = payload as ActionPayloads["reject_document"];
        const file = await fetchFile(ctx.sb, ctx.engagementId, p.file_id);
        if (!file) return { ok: false, code: "state_changed" };
        if ((file.review_status ?? null) !== (p.prior_status ?? null)) {
          return { ok: false, code: "state_changed" };
        }
        await rejectFile(ctx.sb, p.file_id, p.reason, ctx.userId);
        await logUserActivity(ctx.firmId, ctx.engagementId, "reject_item", {
          item_id: file.request_item_id ?? undefined,
          file_id: p.file_id,
          via: "assistant",
        });
        break;
      }
      case "send_reminder": {
        const engagement = await fetchChatEngagement(ctx.sb, ctx.engagementId);
        if (
          !engagement ||
          !engagement.sent_at ||
          !["sent", "in_progress"].includes(engagement.status)
        ) {
          return { ok: false, code: "state_changed" };
        }
        const recent = await lastManualReminderAt(ctx.sb, ctx.engagementId);
        if (recent) return { ok: false, code: "reminded_recently" };
        const sent = await sendReminderEmail(ctx.sb, engagement, ctx.firmId);
        if (!sent) return { ok: false, code: "execute_failed" };
        await logUserActivity(ctx.firmId, ctx.engagementId, "manual_reminder", {
          via: "assistant",
        });
        break;
      }
      case "add_checklist_item": {
        const p = payload as ActionPayloads["add_checklist_item"];
        const item = await addItemToEngagement({
          engagement_id: ctx.engagementId,
          label: p.label,
          // Same convention as the add-item route: label_fr mirrors label
          // until the accountant customizes translations.
          label_fr: p.label,
          doc_type: p.doc_type as DocType,
          required: p.required,
        });
        await logUserActivity(ctx.firmId, ctx.engagementId, "add_item", {
          item_id: item.id,
          label: p.label,
          via: "assistant",
        });
        break;
      }
      case "edit_checklist_item": {
        const p = payload as ActionPayloads["edit_checklist_item"];
        const item = await fetchItem(ctx.sb, ctx.engagementId, p.item_id);
        if (!item || item.kind === "signature") {
          return { ok: false, code: "state_changed" };
        }
        await updateRequestItem(p.item_id, {
          ...(p.changes.new_label !== undefined
            ? { label: p.changes.new_label, label_fr: p.changes.new_label }
            : {}),
          ...(p.changes.required !== undefined
            ? { required: p.changes.required }
            : {}),
          ...(p.changes.doc_type !== undefined
            ? { doc_type: p.changes.doc_type as DocType }
            : {}),
        });
        await logUserActivity(ctx.firmId, ctx.engagementId, "item_updated", {
          item_id: p.item_id,
          via: "assistant",
        });
        break;
      }
      case "remove_checklist_item": {
        const p = payload as ActionPayloads["remove_checklist_item"];
        const item = await fetchItem(ctx.sb, ctx.engagementId, p.item_id);
        if (!item || item.kind === "signature") {
          return { ok: false, code: "state_changed" };
        }
        // The card warned about deleting p.files_count documents. If the
        // client uploaded MORE since the proposal, confirming would silently
        // delete documents the accountant was never warned about — refuse so
        // they re-propose against an accurate count. Fewer is fine (no
        // surprise), so only guard against an increase.
        const countRes = await ctx.sb
          .from("uploaded_files")
          .select("id", { count: "exact", head: true })
          .eq("request_item_id", p.item_id);
        if (countRes.error) throw countRes.error;
        if ((countRes.count ?? 0) > p.files_count) {
          return { ok: false, code: "state_changed" };
        }
        await removeItem(p.item_id);
        await logUserActivity(ctx.firmId, ctx.engagementId, "remove_item", {
          item_id: p.item_id,
          via: "assistant",
        });
        break;
      }
      case "change_due_date": {
        const p = payload as ActionPayloads["change_due_date"];
        const engagement = await fetchChatEngagement(ctx.sb, ctx.engagementId);
        if (!engagement) return { ok: false, code: "state_changed" };
        await updateEngagementDueDate(ctx.engagementId, p.to);
        // Only the OVERDUE reminder depends on the due date; move just that
        // one (rescheduleOverdueReminder leaves the sent-anchored tones
        // alone). Best-effort so a reminder-queue hiccup doesn't report the
        // whole action as failed when the date change already succeeded.
        if (["sent", "in_progress"].includes(engagement.status)) {
          try {
            await rescheduleOverdueReminder({
              engagementId: ctx.engagementId,
              dueDate: p.to,
            });
          } catch (e) {
            console.error("[engagement-chat] overdue reschedule failed:", e);
          }
        }
        await logUserActivity(ctx.firmId, ctx.engagementId, "due_date_changed", {
          from: p.from ?? undefined,
          to: p.to ?? undefined,
          via: "assistant",
        });
        break;
      }
      case "change_assignee": {
        const p = payload as ActionPayloads["change_assignee"];
        const members = await listActiveFirmUsers();
        if (!members.some((m) => m.id === p.user_id)) {
          return { ok: false, code: "state_changed" };
        }
        const res = await ctx.sb
          .from("engagements")
          .update({
            assigned_user_id: p.user_id,
            assigned_at: new Date().toISOString(),
          })
          .eq("id", ctx.engagementId)
          .eq("firm_id", ctx.firmId);
        if (res.error) throw res.error;
        await logUserActivity(
          ctx.firmId,
          ctx.engagementId,
          "engagement_reassigned",
          { to_user_id: p.user_id, via: "assistant" },
        );
        break;
      }
    }
    revalidateEngagement(ctx.engagementId);
    return { ok: true };
  } catch (err) {
    console.error(`[engagement-chat] execute ${type} failed:`, err);
    return { ok: false, code: "execute_failed" };
  }
}

// Mirrors deliverInviteEmail in src/app/actions/engagements.ts (not exported
// there) — invite email to the client's portal link, best-effort.
async function sendReminderEmail(
  sb: SupabaseClient,
  engagement: ChatEngagementRow,
  firmId: string,
): Promise<boolean> {
  try {
    const magicRes = await sb
      .from("engagements")
      .select("magic_token")
      .eq("id", engagement.id)
      .maybeSingle();
    if (magicRes.error) throw magicRes.error;
    const magicToken = (magicRes.data as { magic_token: string | null } | null)
      ?.magic_token;
    if (!magicToken) return false;

    const firmRes = await sb
      .from("firms")
      .select("name, logo_url")
      .eq("id", firmId)
      .maybeSingle();
    if (firmRes.error) throw firmRes.error;
    const firm = firmRes.data as { name: string; logo_url: string | null } | null;
    const client = await getClient(engagement.client_id);
    if (!firm || !client?.email) return false;

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const url = `${appUrl}/r/${magicToken}`;
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
    return true;
  } catch (err) {
    console.error("[engagement-chat] reminder email failed:", err);
    return false;
  }
}
