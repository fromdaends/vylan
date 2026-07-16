// Action strings that can appear in activity_log. Used by /settings/audit:
// - the server-rendered page validates the ?action= URL param against
//   this list before passing it to the DB
// - the client-rendered filter dropdown renders one item per action
//
// Order here = order in the dropdown. Grouped by who triggers the action
// (accountant, client, AI, system) for the operator's mental model.
//
// Lives in its own non-"use client" module so server + client imports
// don't cross the React server/client boundary (which would otherwise
// turn the runtime array into a client reference and break .includes).

export const AUDIT_ACTIONS = [
  // accountant actions
  "approve_item",
  "reject_item",
  "reopen_item",
  "add_item",
  "item_updated",
  "remove_item",
  "manual_reminder",
  "due_date_changed",
  "complete_engagement",
  "cancel_engagement",
  "reopen_engagement",
  "reminders_paused",
  "reminders_resumed",
  "data_export",
  "bulk_download",
  "ai_rejection_overridden",
  // client portal actions
  "client_uploaded",
  "client_marked_na",
  "client_undid_na",
  "client_message_sent",
  // AI verdicts
  "ai_classified",
  "ai_auto_rejected",
  "ai_escalated_to_accountant",
  "ai_quality_flagged",
  // system events
  "reminder_fired",
  "client_retry_email_sent",
  "client_retry_sms_sent",
  // team / multi-user
  "invite_created",
  "invite_accepted",
  "invite_revoked",
  "invite_resent",
  "engagement_reassigned",
  "client_reassigned",
  "user_deactivated",
  "user_reactivated",
  "ownership_transferred",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(v: string | undefined | null): v is AuditAction {
  return !!v && (AUDIT_ACTIONS as readonly string[]).includes(v);
}
