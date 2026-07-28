// Recipient resolution for notify() — PURE, so every rule in the spec's
// ordered list is unit-testable without a database or a clock.
//
// The rules, in order (spec Part 2):
//   1. candidate recipients = firm members, filtered by the event's owner_only
//   2. drop the actor — nobody is told about a thing they just did themselves
//   3. drop users on `assigned_only` scope who are not on the related engagement
//   4. drop users who muted this entity, or its parent engagement/client
//   5. apply per-event in_app / email preferences separately (falling back to
//      the catalog defaults when the user has no row)
//
// Bundling (rule 6) and delivery timing (rules 7-8) are NOT here: bundling needs
// to read existing rows, and timing lives in schedule.ts.

import type { NotificationEvent } from "./catalog";
import type { EmailMode } from "./schedule";

export type NotificationScopeMode = "assigned_only" | "all_firm";

export type RecipientSettings = {
  emailEnabled: boolean;
  scope: NotificationScopeMode;
  emailMode: EmailMode;
  dailyDigestTime: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  pauseWeekends: boolean;
  emailDetailLevel: "full" | "minimal";
};

export type RecipientCandidate = {
  userId: string;
  role: "owner" | "staff";
  locale: "en" | "fr";
  email: string | null;
  settings: RecipientSettings;
  // The user's saved override for THIS event, or null to use catalog defaults.
  pref: { inApp: boolean; email: boolean } | null;
  // Mute keys this user has set, as `${entityType}:${entityId}`.
  mutes: ReadonlySet<string>;
};

export type ResolvedRecipient = {
  userId: string;
  locale: "en" | "fr";
  // The address. Separate from the `email` channel flag below, which is whether
  // they want email for THIS event at all.
  emailAddress: string | null;
  inApp: boolean;
  email: boolean;
  settings: RecipientSettings;
};

export type DropReason =
  | "owner_only"
  | "is_actor"
  | "not_assigned"
  | "muted"
  | "all_channels_off";

export type ResolutionResult = {
  recipients: ResolvedRecipient[];
  // Kept for observability — the emitter logs counts, and the tests assert on
  // WHY someone was dropped rather than just that they were.
  dropped: { userId: string; reason: DropReason }[];
};

// Every mute key that should silence a notification about this entity. Muting an
// ENGAGEMENT also silences its documents and signatures; muting a CLIENT also
// silences everything under that client. Without this, "mute this engagement"
// would only stop notifications whose entity is literally the engagement row.
export function muteKeysFor(input: {
  entity: { type: string; id: string } | null;
  engagementId?: string | null;
  clientId?: string | null;
}): string[] {
  const keys: string[] = [];
  if (input.entity && (input.entity.type === "engagement" || input.entity.type === "client")) {
    keys.push(`${input.entity.type}:${input.entity.id}`);
  }
  if (input.engagementId) keys.push(`engagement:${input.engagementId}`);
  if (input.clientId) keys.push(`client:${input.clientId}`);
  return Array.from(new Set(keys));
}

export function resolveRecipients(input: {
  event: NotificationEvent;
  actorId: string | null;
  candidates: readonly RecipientCandidate[];
  // Mute keys computed by muteKeysFor for this notification.
  muteKeys: readonly string[];
  // Users assigned to the related engagement. Empty when the notification isn't
  // engagement-scoped — see the note on rule 3 below.
  assignedUserIds: ReadonlySet<string>;
  // True when this notification relates to an engagement at all. An
  // `assigned_only` user should still hear about firm-level things (a dead
  // integration, a failed subscription charge) that have no engagement to be
  // assigned to — otherwise the narrow scope would silently hide events that
  // are not about engagements in the first place.
  isEngagementScoped: boolean;
  // True when the caller named these recipients explicitly (an @mention, an
  // assignment) rather than fanning out across the firm. Scope is a filter on
  // "how much of the firm do I want to hear about"; it must NOT silently drop
  // a message addressed to you personally. Without this, @mentioning a
  // teammate on assigned_only scope who is not the assignee notifies nobody
  // and tells the author nothing.
  explicitRecipients?: boolean;
}): ResolutionResult {
  const { event, actorId, candidates, muteKeys, assignedUserIds } = input;
  const recipients: ResolvedRecipient[] = [];
  const dropped: { userId: string; reason: DropReason }[] = [];

  for (const c of candidates) {
    // Rule 1 — owner-only events never reach staff.
    if (event.ownerOnly && c.role !== "owner") {
      dropped.push({ userId: c.userId, reason: "owner_only" });
      continue;
    }

    // Rule 2 — never notify someone about their own action.
    if (actorId && c.userId === actorId) {
      dropped.push({ userId: c.userId, reason: "is_actor" });
      continue;
    }

    // Rule 3 — narrow scope drops engagements you're not on. Skipped for
    // personally-addressed notifications (see explicitRecipients above).
    if (
      !input.explicitRecipients &&
      c.settings.scope === "assigned_only" &&
      input.isEngagementScoped &&
      !assignedUserIds.has(c.userId)
    ) {
      dropped.push({ userId: c.userId, reason: "not_assigned" });
      continue;
    }

    // Rule 4 — muted entity (or its parent engagement / client).
    if (muteKeys.some((k) => c.mutes.has(k))) {
      dropped.push({ userId: c.userId, reason: "muted" });
      continue;
    }

    // Rule 5 — per-event switches, resolved independently for each channel.
    // A locked event (canDisable: false) ignores any stored preference: the row
    // may exist from before the event was locked, or from a hand-edited API
    // call, and either way "required" has to actually mean required.
    const inApp = event.canDisable ? (c.pref?.inApp ?? event.defaultInApp) : true;
    const wantsEmail = event.canDisable
      ? (c.pref?.email ?? event.defaultEmail)
      : true;

    if (!inApp && !wantsEmail) {
      dropped.push({ userId: c.userId, reason: "all_channels_off" });
      continue;
    }

    recipients.push({
      userId: c.userId,
      locale: c.locale,
      emailAddress: c.email,
      inApp,
      email: wantsEmail,
      settings: c.settings,
    });
  }

  return { recipients, dropped };
}
