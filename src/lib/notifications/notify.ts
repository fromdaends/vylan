// notify() — the ONE way anything in the app raises a notification.
//
// Nothing writes to the `notifications` table directly. Call sites pass what
// happened; this decides who hears about it, on which channels, and when.
//
// Two invariants everything else depends on:
//
//   1. It NEVER throws. A notification is a side effect of a business action
//      (an upload, a payment, a webhook); a failure to tell someone must never
//      roll back or 500 the thing that actually happened. Every failure path
//      here logs and returns a result object.
//   2. It NEVER blocks on email. Emails are always handed to the `jobs` queue,
//      even "instant" ones, so an SMTP round-trip can never sit inside an
//      upload handler. The queue drains every 2 minutes, which is well inside
//      the latency this product already ships (the client-message email is
//      debounced 5 minutes, the assignment email 2 hours).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";
import {
  NOTIFICATIONS_SCHEMA_MISSING,
  bumpNotification,
  findBundleTarget,
  insertNotifications,
  loadFirmRecipients,
  type NotificationInsert,
} from "@/lib/db/notifications";
import { getNotificationEvent, type NotificationEntityType } from "./catalog";
import { muteKeysFor, resolveRecipients } from "./resolve";
import { resolveEmailDelivery } from "./schedule";

// How far back bundling will reach to fold a repeat occurrence into an existing
// unread row.
//
// The spec proposed 10 minutes. This is 24 hours deliberately: the CURRENT
// derived feed shows exactly ONE "documents uploaded" row per engagement with no
// time limit at all, so a 10-minute window would be a REGRESSION — a client
// uploading over an afternoon would generate several notifications where today
// they generate one. 24h keeps today's "one row per engagement per day"
// behaviour and still trivially satisfies "8 documents in two minutes produces
// exactly one notification". Only events flagged `bundle: true` in the catalog
// use it at all.
export const BUNDLE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NotifyEntity = { type: NotificationEntityType; id: string };

export type NotifyInput = {
  firmId: string;
  eventKey: string;
  entity?: NotifyEntity | null;
  // The user who caused it. Null for client-driven or system events (clients
  // have no user row). Never notified about their own action.
  actorId?: string | null;
  payload?: Record<string, unknown>;
  // Explicit recipient override. Skips firm-wide resolution but still honours
  // per-event preferences, mutes and the actor rule.
  recipients?: string[];
  // Parent context, so muting an engagement also silences its documents and
  // signatures, and so `assigned_only` can be evaluated. Pass whatever is known.
  engagementId?: string | null;
  clientId?: string | null;
  // "This call site already owns its own email path — write the in-app row
  // only." Used by engagement assignment, where a pre-existing job already
  // sends a smarter email (it waits 2h and skips anyone who has been active in
  // the app since). Without this the assignee would be emailed twice about the
  // same thing. The per-event Email switch still governs that job — see
  // wantsEmailFor() below, which the job calls before sending.
  suppressEmail?: boolean;
  // Test seam only — production always uses the real clock.
  now?: Date;
};

export type NotifyResult = {
  delivered: number;
  bundled: number;
  emailsQueued: number;
  skipped?: "unknown_event" | "schema_missing" | "no_recipients";
};

const EMPTY: NotifyResult = { delivered: 0, bundled: 0, emailsQueued: 0 };

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  try {
    return await runNotify(input);
  } catch (err) {
    // Invariant 1. Nothing above this line may escape.
    console.error(`[notify] ${input.eventKey} failed:`, err);
    return EMPTY;
  }
}

async function runNotify(input: NotifyInput): Promise<NotifyResult> {
  const event = getNotificationEvent(input.eventKey);
  if (!event) {
    // A typo in a call site is a bug, but not one worth taking a request down
    // for. Loud in the logs, silent to the user.
    console.error(`[notify] unknown event key: ${input.eventKey}`);
    return { ...EMPTY, skipped: "unknown_event" };
  }

  const now = input.now ?? new Date();
  const sb = getServiceRoleSupabase();
  const entity = input.entity ?? null;

  const firmTimezone = await getFirmTimezone(sb, input.firmId);

  const candidatesOrMissing = await loadFirmRecipients(sb, {
    firmId: input.firmId,
    eventKey: input.eventKey,
    firmTimezone,
  });
  if (candidatesOrMissing === NOTIFICATIONS_SCHEMA_MISSING) {
    // 0920 not applied yet. Deploy-safe no-op.
    return { ...EMPTY, skipped: "schema_missing" };
  }

  const candidates = input.recipients
    ? candidatesOrMissing.filter((c) => input.recipients!.includes(c.userId))
    : candidatesOrMissing;
  if (candidates.length === 0) return { ...EMPTY, skipped: "no_recipients" };

  // Who is assigned to the related engagement, for the assigned_only rule.
  const engagementId =
    input.engagementId ?? (entity?.type === "engagement" ? entity.id : null);
  const assignedUserIds = await getEngagementAssignees(sb, engagementId);

  const { recipients } = resolveRecipients({
    event,
    actorId: input.actorId ?? null,
    candidates,
    muteKeys: muteKeysFor({
      entity,
      engagementId,
      clientId: input.clientId ?? null,
    }),
    assignedUserIds,
    isEngagementScoped: engagementId != null,
  });
  if (recipients.length === 0) return { ...EMPTY, skipped: "no_recipients" };

  const basePayload = input.payload ?? {};
  let delivered = 0;
  let bundled = 0;
  let emailsQueued = 0;

  // Rule 6 — bundling. Done per recipient because read state is per recipient:
  // one teammate may have already read the earlier row (so they get a fresh
  // notification) while another has not (so theirs is folded).
  const freshInserts: NotificationInsert[] = [];
  const emailTargets: { notificationId: string; recipientIndex: number }[] = [];

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (!r.inApp && !r.email) continue;

    if (event.bundle) {
      const existing = await findBundleTarget(sb, {
        userId: r.userId,
        eventKey: event.key,
        entityId: entity?.id ?? null,
        since: new Date(now.getTime() - BUNDLE_WINDOW_MS),
      });
      if (existing) {
        const prevCount = countOf(existing.payload);
        const merged: Record<string, unknown> = {
          ...existing.payload,
          ...basePayload,
          count: prevCount + countOf(basePayload),
          // Preserve when the bundle actually began — created_at moves forward
          // so the row resurfaces, so this is the only record of the start.
          first_at: existing.payload.first_at ?? existing.created_at,
        };
        const bumpedRow = await bumpNotification(sb, {
          id: existing.id,
          payload: merged,
          at: now,
        });
        if (bumpedRow) {
          bundled++;
          // Only re-queue an email if none has gone out for this row yet.
          // Otherwise every extra upload would re-email about the same unread
          // notification, which is exactly what bundling exists to prevent.
          if (r.email && !input.suppressEmail && bumpedRow.email_sent_at == null) {
            // Cancel the pending job first so a burst collapses to one email
            // rather than one per upload (same trick client-messages uses).
            await cancelPendingJobs(
              "send_notification_email",
              (p) => p.notification_id === bumpedRow.id,
            ).catch(() => 0);
            emailTargets.push({ notificationId: bumpedRow.id, recipientIndex: i });
          }
          continue;
        }
        // Bump failed — fall through and insert a fresh row rather than losing
        // the notification entirely.
      }
    }

    freshInserts.push({
      firm_id: input.firmId,
      user_id: r.userId,
      event_key: event.key,
      entity_type: entity?.type ?? null,
      entity_id: entity?.id ?? null,
      actor_id: input.actorId ?? null,
      payload: { ...basePayload, first_at: now.toISOString() },
    });
  }

  if (freshInserts.length > 0) {
    const inserted = await insertNotifications(sb, freshInserts);
    if (inserted === NOTIFICATIONS_SCHEMA_MISSING) {
      return { ...EMPTY, skipped: "schema_missing" };
    }
    delivered += inserted.length;
    // Map each inserted row back to its recipient so the email job carries the
    // right locale + settings.
    const byUser = new Map(inserted.map((row) => [row.user_id, row.id]));
    for (let i = 0; i < recipients.length; i++) {
      const id = byUser.get(recipients[i].userId);
      if (id && recipients[i].email && !input.suppressEmail) {
        emailTargets.push({ notificationId: id, recipientIndex: i });
      }
    }
  }

  // Rules 7 + 8 — delivery timing. A locked event bypasses the master switch,
  // quiet hours, the weekend pause and digest batching entirely.
  for (const target of emailTargets) {
    const r = recipients[target.recipientIndex];
    if (!r.emailAddress) continue;
    const decision = resolveEmailDelivery({
      now,
      settings: r.settings,
      bypassDeferral: !event.canDisable,
    });
    if (decision.kind === "suppress") continue;
    const runAfter = decision.kind === "defer" ? decision.sendAfter : now;
    try {
      await enqueueJob({
        kind: "send_notification_email",
        payload: {
          notification_id: target.notificationId,
          user_id: r.userId,
          // Digest jobs group by this; instant sends ignore it.
          mode: decision.kind === "defer" ? decision.reason : "instant",
        },
        runAfter,
      });
      emailsQueued++;
    } catch (err) {
      console.error("[notify] failed to queue email:", err);
    }
  }

  return { delivered, bundled, emailsQueued };
}

// A bundled payload can carry its own count (e.g. "3 files in this upload").
// Absent, one occurrence counts as one.
function countOf(payload: Record<string, unknown>): number {
  const raw = payload.count;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : 1;
}

async function getFirmTimezone(
  sb: SupabaseClient,
  firmId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("firms")
    .select("timezone")
    .eq("id", firmId)
    .maybeSingle();
  return (data as { timezone: string | null } | null)?.timezone ?? null;
}

// Who counts as "assigned" for the assigned_only scope. Today an engagement has
// a single assigned_user_id; this returns a Set so multi-assignee later is a
// one-line change here rather than a change to the resolver.
async function getEngagementAssignees(
  sb: SupabaseClient,
  engagementId: string | null,
): Promise<Set<string>> {
  if (!engagementId) return new Set();
  const { data } = await sb
    .from("engagements")
    .select("assigned_user_id")
    .eq("id", engagementId)
    .maybeSingle();
  const assigned = (data as { assigned_user_id: string | null } | null)
    ?.assigned_user_id;
  return assigned ? new Set([assigned]) : new Set();
}

/**
 * Does this user want EMAIL for this event?
 *
 * Exported for call sites that own their own email path (today: the delayed
 * assignment catch-up). Without this, the Email switch on the settings page
 * would silently do nothing for those events — the switch would be a lie.
 *
 * Fails OPEN (returns true) on any error or when the schema is not applied:
 * losing an email someone expected is worse than sending one they could have
 * turned off, and this only runs for events that already emailed before.
 */
export async function wantsEmailFor(
  sb: SupabaseClient,
  userId: string,
  eventKey: string,
): Promise<boolean> {
  const event = getNotificationEvent(eventKey);
  if (!event) return true;
  if (!event.canDisable) return true;
  try {
    const [{ data: settings }, { data: pref }] = await Promise.all([
      sb
        .from("notification_settings")
        .select("email_enabled")
        .eq("user_id", userId)
        .maybeSingle(),
      sb
        .from("notification_preferences")
        .select("email")
        .eq("user_id", userId)
        .eq("event_key", eventKey)
        .maybeSingle(),
    ]);
    const masterOn =
      (settings as { email_enabled: boolean } | null)?.email_enabled ?? true;
    if (!masterOn) return false;
    return (
      (pref as { email: boolean } | null)?.email ?? event.defaultEmail
    );
  } catch {
    return true;
  }
}
