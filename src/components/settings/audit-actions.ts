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
  "client_viewed_portal",
  "client_opened_documents",
  "client_opened_signatures",
  "client_opened_messages",
  "client_opened_signature",
  "client_downloaded_deliverable",
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
  "engagement_unassigned",
  // A handoff note written AFTER the reassignment, from the toast. Its own
  // action rather than editing the reassignment row: an audit log is
  // append-only, and "Tyler added a handoff note" is a truthful second event.
  "engagement_handoff_note",
  // Phase 2: an owner changed what a teammate is allowed to do.
  "team_permissions_changed",
  "client_reassigned",
  "client_privacy_changed",
  "engagement_privacy_changed",
  // Per-job access (1310). Registered WITH the feature, not after it — this
  // file's own notes record the audit log printing raw codes twice because an
  // action was logged before it was listed.
  "engagement_access_granted",
  "engagement_access_revoked",
  "firm_settings_changed",
  "user_deactivated",
  "user_reactivated",
  "ownership_transferred",
  // Bulk handover. team_offboard_reassigned predates this list — offboarding has
  // logged it since Wave 2 but it was never registered, so the audit log printed
  // the raw code (same failure mode the recurrence_* note below describes).
  // team_work_handed_over is new: the same move without removing anybody.
  "team_offboard_reassigned",
  "team_work_handed_over",
  // repeating work. recurrence_* predate this list — they were logged by
  // the Repeat dialog but never registered, so the audit log rendered the
  // raw code. series_reassigned is new with the /repeating screen.
  "recurrence_paused",
  "recurrence_resumed",
  // One-recurrence rule: create dropped a Repeat because the items already
  // bill on a schedule (founder ruling — never both, it double-charges).
  "repeat_dropped",
  "recurrence_ended",
  "series_reassigned",
  // Files section. Registered in the SAME change that starts logging them —
  // the comments above record what happens otherwise: recurrence_* and
  // team_offboard_reassigned were emitted for months without being listed
  // here, so /settings/audit printed the raw action code at the operator.
  // Each one also needs an `action_<key>` string in messages/{en,fr}.json.
  "file_renamed",
  "file_moved",
  "file_downloaded",
  "file_deleted",
  "file_restored",
  "documents_imported",
  "folder_created",
  "folder_renamed",
  "folder_moved",
  "folder_deleted",
  // Bookkeeping — the ledger-side loop (#1106, #1112, #1115, #1116) and the
  // roster profile (#1123). Every one of these was being emitted without a
  // listing here, which is the exact failure the note above records: the audit
  // page printed the raw action code at the operator.
  "request_receipts",
  "ask_about_transactions",
  "categorize_transaction",
  "close_month",
  "reopen_month",
  "client_answered_question",
  // Phase 3 slice 1 — the client cast (#1210).
  "client_member_added",
  "client_member_removed",
  // Firm roles (#1260).
  "firm_role_created",
  "firm_role_deleted",
  "firm_role_permissions_changed",
  // Time tracking (1750). Registered in the SAME change that starts logging
  // them — the notes above record what happens otherwise (raw codes printed at
  // the operator). ⚠️ member_rate_changed metadata NEVER carries amounts:
  // activity_log is firm-readable, rates are not.
  "time_entry_created",
  "time_entry_updated",
  "time_entry_deleted",
  "member_rate_changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(v: string | undefined | null): v is AuditAction {
  return !!v && (AUDIT_ACTIONS as readonly string[]).includes(v);
}
