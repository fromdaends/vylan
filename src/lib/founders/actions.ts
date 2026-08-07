// READING activity_log — turning ~130 internal event names into something a
// founder can scan at 3am.
//
// activity_log.action is a free-text column written by about forty different
// call sites ("client_uploaded", "engagement_purged", "qbo_draft_status"). The
// founders console shows every one of them, which is the whole point of the
// feature — "as much activity as possible" — but an undifferentiated wall of
// snake_case is not information.
//
// So two transforms, both PURE and both tested:
//
//   category(action)  →  one of a dozen buckets, for colour + filtering
//   humanise(action)  →  a readable phrase
//
// ── WHY THE FALLBACK IS THE IMPORTANT PART ────────────────────────────────────
//
// There is no exhaustive list here and there must never be one. New actions get
// added by whichever session ships the next feature, and they will not think to
// update this file. A lookup table would therefore go stale silently, and the
// failure mode would be the worst kind: the newest events — the ones a founder
// most wants to see — rendering as blanks or dropping out of a filter.
//
// Every function below is total. An action nobody has ever seen still gets a
// category (by prefix, then "other"), still gets a readable label (underscores
// to spaces), and still appears in the feed. Categorisation is a nicety; not
// losing the event is the requirement.

export type ActivityCategory =
  | "engagement"
  | "document"
  | "money"
  | "message"
  | "client"
  | "team"
  | "portal"
  | "ai"
  | "automation"
  | "time"
  | "admin"
  | "other";

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "engagement",
  "document",
  "money",
  "message",
  "client",
  "team",
  "portal",
  "ai",
  "automation",
  "time",
  "admin",
  "other",
] as const;

/**
 * Exact-match overrides, for the actions whose names do not carry their own
 * category. Everything else is decided by the prefix rules below, so this list
 * only needs to grow when a name is genuinely ambiguous — not for every new
 * event.
 */
const EXACT: Record<string, ActivityCategory> = {
  // Work on the engagement's checklist. "add_item"/"approve_item" read like
  // generic CRUD but they are always request-checklist items.
  add_item: "engagement",
  approve_item: "engagement",
  reject_item: "engagement",
  remove_item: "engagement",
  reopen_item: "engagement",
  item_updated: "engagement",
  due_date_changed: "engagement",
  materialize_tasks: "engagement",
  assign: "engagement",
  claim: "engagement",
  attach: "engagement",
  create: "engagement",
  entered: "engagement",
  give_up: "engagement",
  pause: "engagement",

  // The client did something in the portal.
  client_uploaded: "portal",
  client_answered_question: "portal",
  client_marked_na: "portal",
  client_undid_na: "portal",
  client_viewed_portal: "portal",
  client_downloaded_deliverable: "portal",
  client_opened_signature: "portal",
  client_retry_email_sent: "portal",
  client_retry_sms_sent: "portal",
  proposal_accepted: "portal",
  proposal_declined: "portal",
  booking: "portal",

  // Money.
  payment_recorded: "money",
  payment_requested: "money",
  recurring_charge_raised: "money",

  // Documents / files.
  bulk_download: "document",
  documents_imported: "document",
  data_export: "document",
  folder_created: "document",
  folder_deleted: "document",
  folder_moved: "document",
  folder_renamed: "document",
  soft_delete: "document",

  // Bookkeeping drafts are money-shaped work, not "qbo admin".
  categorize_transaction: "money",
  ask_about_transactions: "money",
  request_receipts: "money",
  close_month: "money",
  reopen_month: "money",

  // Firm administration.
  firm_settings_changed: "admin",
  ownership_transferred: "admin",
  logout: "admin",
  theme: "admin",
  reminder_fired: "automation",
  manual_reminder: "automation",
  recurrence_spawned: "automation",
  recurrence_ended: "automation",
  recurrence_paused: "automation",
  signature_requested: "engagement",
};

/**
 * Prefix rules, checked in order. First match wins, so the more specific
 * prefixes come first ("invoice_" before "inv", "client_member_" before
 * "client_").
 */
const PREFIXES: ReadonlyArray<readonly [string, ActivityCategory]> = [
  ["engagement_letter", "automation"],
  ["engagement_access", "team"],
  ["engagement_privacy", "admin"],
  ["engagement", "engagement"],
  ["proposal", "portal"],
  ["invoice", "money"],
  ["payment", "money"],
  ["qbo", "money"],
  ["post_qbo", "money"],
  ["bulk_approve_qbo", "money"],
  ["bulk_post_qbo", "money"],
  ["delete_qbo", "money"],
  ["void_qbo", "money"],
  ["file", "document"],
  ["final_document", "document"],
  ["client_message", "message"],
  ["client_member", "team"],
  ["client_relationship", "client"],
  ["client_privacy", "admin"],
  ["client_reassigned", "client"],
  ["client", "portal"],
  ["portal", "portal"],
  ["ai_", "ai"],
  ["incomplete_set", "ai"],
  ["automation", "automation"],
  ["time_entry", "time"],
  ["member_rate", "team"],
  ["team", "team"],
  ["user_", "team"],
  ["invite", "team"],
  ["firm_role", "admin"],
  ["firm_", "admin"],
  ["recurrence", "automation"],
  ["recurring", "automation"],
  ["reminder", "automation"],
];

/** Which bucket does this event belong in? Total — never throws, never null. */
export function activityCategory(action: string | null | undefined): ActivityCategory {
  if (!action) return "other";
  const key = action.trim().toLowerCase();
  if (!key) return "other";
  const exact = EXACT[key];
  if (exact) return exact;
  for (const [prefix, category] of PREFIXES) {
    if (key.startsWith(prefix)) return category;
  }
  return "other";
}

/**
 * A readable phrase for an event name.
 *
 * "engagement_reassigned" → "Engagement reassigned"
 * "qbo_draft_status"      → "QBO draft status"
 *
 * Only the initialisms get special treatment; everything else is
 * underscores-to-spaces with a leading capital. That is deliberately dumb: the
 * names were written by developers to be read by developers, they are already
 * close to English, and a hand-written dictionary would be wrong for whatever
 * ships tomorrow. An unrecognised name still comes out readable.
 */
const INITIALISMS: Record<string, string> = {
  qbo: "QBO",
  ai: "AI",
  na: "N/A",
  sms: "SMS",
  pin: "PIN",
  t1: "T1",
  t2: "T2",
};

export function humaniseAction(action: string | null | undefined): string {
  if (!action) return "Unknown";
  const words = action.trim().toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return "Unknown";
  const mapped = words.map((w) => INITIALISMS[w] ?? w);
  const [first, ...rest] = mapped;
  const head =
    first === INITIALISMS[words[0]] ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return [head, ...rest].join(" ");
}

/**
 * Who did it, as a one-word noun. activity_log.actor_type is an enum
 * ('user' | 'client' | 'system') but reads arrive as plain strings, so an
 * unexpected value degrades to "system" rather than rendering raw.
 */
export function actorLabel(actorType: string | null | undefined): "user" | "client" | "system" {
  return actorType === "user" || actorType === "client" ? actorType : "system";
}

/**
 * Tailwind classes per category — the ONE place a category's colour is
 * decided, so the feed dot, the filter chip and the legend can never disagree.
 * Uses the app's semantic tokens rather than raw palette colours so both
 * themes follow.
 */
export const CATEGORY_DOT: Record<ActivityCategory, string> = {
  engagement: "bg-sky-500",
  document: "bg-violet-500",
  money: "bg-emerald-500",
  message: "bg-blue-500",
  client: "bg-teal-500",
  team: "bg-amber-500",
  portal: "bg-fuchsia-500",
  ai: "bg-indigo-500",
  automation: "bg-cyan-500",
  time: "bg-orange-500",
  admin: "bg-slate-500",
  other: "bg-muted-foreground",
};
