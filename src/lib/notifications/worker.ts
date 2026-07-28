// Worker for `send_notification_email` jobs — the ONLY place a notification
// email actually leaves the building.
//
// Runs from /api/cron/process-jobs every 2 minutes. Deliberately re-checks
// everything at send time rather than trusting what was true when the job was
// queued, because minutes or hours may have passed:
//
//   * already emailed        -> skip (makes a retry idempotent)
//   * dismissed since        -> skip (the user deleted it)
//   * read in-app since      -> skip (they already know; email would be noise)
//   * email switched off since -> skip, unless the event is a locked one
//
// Digest modes sweep: the FIRST due digest job for a user gathers every other
// pending notification for that user into one email and stamps them all as
// sent, so the remaining jobs find email_sent_at set and no-op. That is what
// makes "one digest" one email rather than one per notification.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import {
  isNotificationsSchemaMissing,
  type NotificationRow,
} from "@/lib/db/notifications";
import { getNotificationEvent } from "./catalog";
import { buildDigestEmail, buildNotificationEmail } from "./email";
import type { EmailLocale } from "./email-copy";

export type NotificationEmailResult = {
  skipped?: string;
  sent?: boolean;
  bundledCount?: number;
};

// How many notifications one digest email will list. Beyond this the digest
// links to the full feed rather than growing without bound.
export const DIGEST_MAX_ROWS = 50;

const DIGEST_MODES = new Set(["hourly_digest", "daily_digest"]);

export async function processSendNotificationEmailJob(
  payload: Record<string, unknown>,
): Promise<NotificationEmailResult> {
  const notificationId = String(payload.notification_id ?? "");
  const mode = String(payload.mode ?? "instant");
  if (!notificationId) return { skipped: "missing_notification_id" };

  const sb = getServiceRoleSupabase();

  const { data: rowData, error } = await sb
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .maybeSingle();
  if (error) {
    if (isNotificationsSchemaMissing(error)) return { skipped: "schema_missing" };
    throw error;
  }
  const row = rowData as NotificationRow | null;
  if (!row) return { skipped: "notification_not_found" };

  if (row.email_sent_at) return { skipped: "already_sent" };
  if (row.dismissed_at) return { skipped: "dismissed" };
  if (row.read_at) return { skipped: "already_read_in_app" };

  const event = getNotificationEvent(row.event_key);
  if (!event) return { skipped: "unknown_event" };

  const recipient = await loadRecipient(sb, row.user_id);
  if (!recipient?.email) return { skipped: "no_recipient_email" };

  // Locked events ignore the master switch (rule 8) — a failed subscription
  // charge still has to reach the owner.
  if (!recipient.emailEnabled && event.canDisable) {
    return { skipped: "email_disabled" };
  }

  if (DIGEST_MODES.has(mode)) {
    return sendDigest(sb, { row, recipient });
  }

  const built = buildNotificationEmail({
    row,
    recipientName: recipient.name,
    locale: recipient.locale,
    detailLevel: recipient.detailLevel,
  });
  if (!built) return { skipped: "no_copy_for_event" };

  // Claim before sending, same reasoning as the digest path: stamp first with
  // an `email_sent_at is null` predicate so a duplicate job (a cancel/enqueue
  // race in the bundle path) cannot also send. Zero rows back means someone
  // else already owns this send.
  const { data: claimed, error: claimErr } = await sb
    .from("notifications")
    .update({ email_sent_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("email_sent_at", null)
    .select("id");
  if (claimErr) {
    if (isNotificationsSchemaMissing(claimErr)) return { skipped: "schema_missing" };
    throw claimErr;
  }
  if ((claimed ?? []).length === 0) return { skipped: "already_sent" };

  const res = await sendEmail({
    to: recipient.email,
    subject: built.subject,
    html: built.html,
    text: built.text,
  });
  if (!res.sent) {
    // Hand it back so the queue's backoff can retry it.
    await releaseClaim(sb, [row]);
    throw new Error(`notification email failed: ${res.reason}`);
  }
  return { sent: true };
}

async function sendDigest(
  sb: SupabaseClient,
  args: { row: NotificationRow; recipient: Recipient },
): Promise<NotificationEmailResult> {
  const { row, recipient } = args;

  // Everything still worth telling this person about, including the row that
  // triggered this job.
  //
  // `email_queued` is the load-bearing filter. notify() writes it at insert
  // time, where the per-event Email preference and suppressEmail are both in
  // scope. Without it the digest sweeps up EVERY unread row and emails things
  // that were deliberately never going to be emailed: events the user switched
  // email off for, and the two events (assignment, client replies) whose email
  // is owned by a legacy job — which would duplicate that job's email.
  const { data, error } = await sb
    .from("notifications")
    .select("*")
    .eq("user_id", row.user_id)
    .is("email_sent_at", null)
    .is("read_at", null)
    .is("dismissed_at", null)
    .eq("payload->>email_queued", "true")
    .order("created_at", { ascending: false })
    .limit(DIGEST_MAX_ROWS);
  if (error) {
    if (isNotificationsSchemaMissing(error)) return { skipped: "schema_missing" };
    throw error;
  }
  const candidates = (data ?? []) as NotificationRow[];
  // The triggering row could have been filtered out by a race (read in another
  // tab between the guard above and this query). If nothing is left, stop.
  if (candidates.length === 0) return { skipped: "nothing_to_digest" };

  // CLAIM BEFORE SENDING.
  //
  // Every notification raised inside one digest window gets the SAME run_after
  // (nextTopOfHour / nextTimeOfDay produce an exact instant), so the cron
  // claims several of this user's digest jobs in one wave and runs them with
  // Promise.all. Reading first and stamping after the send meant each one
  // passed the already-sent guard, built the same row set, and sent its own
  // copy — the user got one identical digest per pending notification.
  //
  // This UPDATE is the compare-and-swap: `email_sent_at is null` means only
  // ONE concurrent job can claim a given row, and we then send exactly the
  // rows we actually won.
  const { data: claimedData, error: claimErr } = await sb
    .from("notifications")
    .update({ email_sent_at: new Date().toISOString() })
    .in(
      "id",
      candidates.map((r) => r.id),
    )
    .is("email_sent_at", null)
    .select("*");
  if (claimErr) {
    if (isNotificationsSchemaMissing(claimErr)) {
      return { skipped: "schema_missing" };
    }
    throw claimErr;
  }
  const rows = (claimedData ?? []) as NotificationRow[];
  // Another job in the same wave got there first and is sending these.
  if (rows.length === 0) return { skipped: "claimed_by_another_job" };

  const built = buildDigestEmail({
    rows,
    recipientName: recipient.name,
    locale: recipient.locale,
    detailLevel: recipient.detailLevel,
  });
  if (!built) {
    await releaseClaim(sb, rows);
    return { skipped: "no_copy_for_event" };
  }

  const res = await sendEmail({
    to: recipient.email!,
    subject: built.subject,
    html: built.html,
    text: built.text,
  });
  if (!res.sent) {
    // Hand the rows back so the queue's retry can pick them up again —
    // otherwise a transient Resend failure would silently swallow the digest.
    await releaseClaim(sb, rows);
    throw new Error(`digest email failed: ${res.reason}`);
  }
  return { sent: true, bundledCount: rows.length };
}

// Undo a claim after a failed send, so a retry can re-claim the rows.
async function releaseClaim(
  sb: SupabaseClient,
  rows: NotificationRow[],
): Promise<void> {
  const { error } = await sb
    .from("notifications")
    .update({ email_sent_at: null })
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (error && !isNotificationsSchemaMissing(error)) {
    console.error("[notifications] releaseClaim failed:", error);
  }
}

type Recipient = {
  email: string | null;
  name: string | null;
  locale: EmailLocale;
  emailEnabled: boolean;
  detailLevel: "full" | "minimal";
};

async function loadRecipient(
  sb: SupabaseClient,
  userId: string,
): Promise<Recipient | null> {
  const { data: user } = await sb
    .from("users")
    .select("email, name, display_name, locale, deactivated_at")
    .eq("id", userId)
    .maybeSingle();
  if (!user) return null;
  const u = user as {
    email: string | null;
    name: string | null;
    display_name: string | null;
    locale: string | null;
    deactivated_at: string | null;
  };
  // A teammate removed between queueing and sending gets nothing.
  if (u.deactivated_at) return null;

  const { data: settings, error: settingsErr } = await sb
    .from("notification_settings")
    .select("email_enabled, email_detail_level")
    .eq("user_id", userId)
    .maybeSingle();
  // No row = defaults (email on, full detail). A missing TABLE also means
  // defaults rather than a crash.
  const s =
    settingsErr && isNotificationsSchemaMissing(settingsErr)
      ? null
      : (settings as {
          email_enabled: boolean;
          email_detail_level: string;
        } | null);

  return {
    email: u.email,
    name: u.display_name?.trim() || u.name?.trim() || null,
    locale: u.locale === "en" ? "en" : "fr",
    emailEnabled: s?.email_enabled ?? true,
    detailLevel: s?.email_detail_level === "minimal" ? "minimal" : "full",
  };
}
