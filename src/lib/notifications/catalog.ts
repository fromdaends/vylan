// The notification event catalog — the SINGLE source of truth for what events
// exist, who may receive them, and what they default to.
//
// A TS constant rather than a seeded table (the spec allowed either): adding an
// event is then a code change reviewed in a PR, not a migration + a data fix, and
// the emitter and the settings UI import literally the same object so they can
// never drift. `notification_preferences` rows reference these keys by string.
//
// Human-readable labels are NOT here. They live in messages/{en,fr}.json under
// the existing `Notifications` namespace, keyed deterministically off the event
// key (see labelKeyFor / descriptionKeyFor below), because every other string in
// this app goes through next-intl and the emails must render in each RECIPIENT's
// language, not the firm's. The catalog stays the single source of truth for
// which events exist; i18n stays the single source of truth for how they read.
//
// v1 scope (Phase 0 audit, founder-approved): 22 events that have a real trigger
// today, plus four cheap high-value additions (signature declined, integration
// sync failed, integration disconnected, billing payment failed). Events whose
// underlying trigger does not exist yet are listed in DEFERRED_EVENT_KEYS at the
// bottom so the gap stays visible instead of being quietly forgotten.

export const NOTIFICATION_CATEGORIES = [
  "documents",
  "engagements",
  "signatures",
  "payments",
  "messages",
  "clients",
  "firm",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationEntityType =
  | "engagement"
  | "client"
  | "document"
  | "invoice"
  | "signature";

export type NotificationEvent = {
  key: string;
  category: NotificationCategory;
  defaultInApp: boolean;
  defaultEmail: boolean;
  // Hidden entirely from staff (not greyed out) and never resolved as a
  // recipient for them.
  ownerOnly: boolean;
  // false = the switches render locked. Also means the event BYPASSES the email
  // master switch, quiet hours, digests and the weekend pause: these are the
  // "you need to know right now" events.
  canDisable: boolean;
  // Whether repeat occurrences collapse into the existing unread row rather than
  // inserting a new one. True for high-frequency drip events (a client uploading
  // documents one at a time); false where each occurrence is independently
  // meaningful (two separate payments are two separate facts).
  bundle: boolean;
  // Position within its category in the settings UI.
  sortOrder: number;
};

// Order here IS the display order within each category.
export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  // ── Documents ────────────────────────────────────────────────────────────
  {
    key: "document.uploaded",
    category: "documents",
    defaultInApp: true,
    defaultEmail: false,
    ownerOnly: false,
    canDisable: true,
    // A client dumping 14 receipts is ONE thing that happened, not 14.
    bundle: true,
    sortOrder: 10,
  },
  {
    key: "document.request_complete",
    category: "documents",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 20,
  },
  {
    // AI flagged a file for a human to look at. Kept separate from rejected and
    // escalated (the audit's recommendation): collapsing all three into one
    // "needs review" toggle would throw away the distinction the 5-strike
    // escalation work deliberately built.
    key: "document.ai_flagged",
    category: "documents",
    defaultInApp: true,
    defaultEmail: false,
    ownerOnly: false,
    canDisable: true,
    bundle: true,
    sortOrder: 30,
  },
  {
    key: "document.ai_rejected",
    category: "documents",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: true,
    sortOrder: 40,
  },
  {
    // The client has been asked to redo the same file up to the strike limit and
    // it still is not usable — a human has to step in. Never bundled: this is
    // the end of the automated road and must not hide inside a count.
    key: "document.ai_escalated",
    category: "documents",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 50,
  },

  // ── Engagements ──────────────────────────────────────────────────────────
  {
    key: "engagement.assigned_to_you",
    category: "engagements",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 10,
  },
  {
    key: "engagement.due_soon",
    category: "engagements",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    // Re-evaluated on a schedule; must collapse or it would repeat daily.
    bundle: true,
    sortOrder: 20,
  },
  {
    key: "engagement.overdue",
    category: "engagements",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: true,
    sortOrder: 30,
  },
  {
    key: "engagement.stalled",
    category: "engagements",
    defaultInApp: true,
    defaultEmail: false,
    ownerOnly: false,
    canDisable: true,
    bundle: true,
    sortOrder: 40,
  },
  {
    key: "engagement.completed",
    category: "engagements",
    defaultInApp: true,
    defaultEmail: false,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 50,
  },

  // ── Signatures ───────────────────────────────────────────────────────────
  {
    // Vylan is single-signer today, so the spec's signer_completed and
    // all_signers_complete are the same event here. One row, not two.
    key: "signature.completed",
    category: "signatures",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 10,
  },
  {
    // The other signing path: the client downloads, signs by hand, uploads the
    // signed copy back. This ALREADY emails the accountant unconditionally
    // today — defaulted on, and the UI labels it clearly (audit risk 2).
    key: "signature.signed_copy_returned",
    category: "signatures",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 20,
  },
  {
    // Locked on: a declined signature kills the engagement and there is no other
    // signal anywhere in the product that it happened.
    key: "signature.declined",
    category: "signatures",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: false,
    bundle: false,
    sortOrder: 30,
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    key: "payment.received",
    category: "payments",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 10,
  },
  {
    key: "payment.failed",
    category: "payments",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 20,
  },

  // ── Messages ─────────────────────────────────────────────────────────────
  {
    // Already emails the assigned accountant unconditionally today, with a
    // 5-minute debounce upstream. Defaulted on (audit risk 3).
    key: "message.client_replied",
    category: "messages",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    bundle: true,
    sortOrder: 10,
  },
  {
    key: "message.internal_mention",
    category: "messages",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: false,
    canDisable: true,
    // Each mention is a separate person asking a separate question.
    bundle: false,
    sortOrder: 20,
  },

  // ── Clients ──────────────────────────────────────────────────────────────
  {
    // Renamed from the spec's `client.invite_accepted`: Vylan clients never make
    // an account, so nothing is ever "accepted". The real signal is the client
    // opening their magic link for the first time.
    key: "client.portal_first_opened",
    category: "clients",
    defaultInApp: true,
    defaultEmail: false,
    ownerOnly: false,
    canDisable: true,
    bundle: false,
    sortOrder: 10,
  },

  // ── Firm & system ────────────────────────────────────────────────────────
  {
    key: "team.member_joined",
    category: "firm",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: true,
    canDisable: true,
    bundle: false,
    sortOrder: 10,
  },
  {
    // Locked on. A silently broken QuickBooks/Xero sync corrupts the firm's
    // books slowly and invisibly; today it fails into jobs.last_error and
    // nobody is ever told.
    key: "integration.sync_failed",
    category: "firm",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: true,
    canDisable: false,
    // A broken connection fails on every run — collapse or it floods.
    bundle: true,
    sortOrder: 20,
  },
  {
    key: "integration.disconnected",
    category: "firm",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: true,
    canDisable: false,
    bundle: false,
    sortOrder: 30,
  },
  {
    // Locked on AND bypasses quiet hours: a failed subscription charge ends in a
    // cancelled account. Acceptance criterion 5.
    key: "billing.payment_failed",
    category: "firm",
    defaultInApp: true,
    defaultEmail: true,
    ownerOnly: true,
    canDisable: false,
    bundle: false,
    sortOrder: 40,
  },
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];

const BY_KEY: ReadonlyMap<string, NotificationEvent> = new Map(
  NOTIFICATION_EVENTS.map((e) => [e.key, e]),
);

export function getNotificationEvent(key: string): NotificationEvent | null {
  return BY_KEY.get(key) ?? null;
}

export function isNotificationEventKey(key: string): key is NotificationEventKey {
  return BY_KEY.has(key);
}

// Events a given role may see. Owner-only events are hidden from staff entirely
// (not rendered disabled) — both in the settings UI and in recipient resolution.
export function eventsForRole(role: "owner" | "staff"): NotificationEvent[] {
  return NOTIFICATION_EVENTS.filter((e) => role === "owner" || !e.ownerOnly);
}

// Catalog grouped for the settings UI, in category order then sortOrder.
export function eventsByCategory(
  role: "owner" | "staff",
): { category: NotificationCategory; events: NotificationEvent[] }[] {
  const visible = eventsForRole(role);
  return NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    events: visible
      .filter((e) => e.category === category)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  })).filter((group) => group.events.length > 0);
}

// i18n key helpers. Deterministic from the event key, so declaring an event in
// the array above is the only place a new event is registered — the label keys
// follow. `document.uploaded` -> `event_document_uploaded_label`.
export function labelKeyFor(eventKey: string): string {
  return `event_${eventKey.replace(/\./g, "_")}_label`;
}

export function descriptionKeyFor(eventKey: string): string {
  return `event_${eventKey.replace(/\./g, "_")}_desc`;
}

// Events from the original spec that have NO trigger in the codebase yet. Kept
// as an explicit, exported list so the gap is visible in code review rather than
// rediscovered later. Each needs its own upstream work (a webhook branch, a
// scheduled check, or device tracking) BEFORE it can be added to the catalog.
export const DEFERRED_EVENT_KEYS = [
  "document.replaced_after_rejection", // no trigger: needs a re-upload-after-rejection hook
  "engagement.stage_changed", // stage machinery exists, emits nothing
  "signature.expiring_soon", // SignWell reports expired, never expiring
  "invoice.overdue", // no invoice dunning of any kind exists
  "payout.deposited", // Connect payout webhook not subscribed
  "message.unanswered", // needs an unanswered-thread sweep
  "client.invite_stale", // needs a "sent but never opened" sweep
  "client.details_updated", // no client-edit audit hook
  "team.role_changed", // no role-change event
  "billing.renewal_upcoming", // needs a scheduled check on current_period_end
  "security.new_device_login", // needs login events + device tracking (largest gap)
  "digest.weekly_summary", // depends on the digest pipeline shipping first
] as const;
