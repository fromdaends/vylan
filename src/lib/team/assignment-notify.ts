// Delayed "assigned to you" catch-up EMAIL. The in-app notification fires
// instantly (src/lib/home/notifications.ts); this is the fallback for a teammate
// who wasn't in the app to see it. Enqueued ~2h out on reassignment and run by
// the job queue, which re-checks that the work is STILL theirs and they STILL
// haven't been active before sending — so someone who showed up gets no email.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { sendEmail, buildTeamAssignmentEmail } from "@/lib/email";

// If the assignee hasn't been back in the app within this window, email them.
// Long enough that an active teammate sees the in-app notification first.
export const ASSIGNMENT_EMAIL_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours

export type AssignmentEmailDecision =
  | "send"
  | "reassigned_away"
  | "no_recipient"
  | "already_active";

// Pure decision: should the delayed catch-up email go out? Kept out of the DB
// handler so the rule is unit-testable.
export function assignmentEmailDecision(input: {
  // The engagement's CURRENT assignee (may have changed since the job enqueued).
  currentAssigneeId: string | null;
  targetAssigneeId: string;
  assigneeDeactivated: boolean;
  assigneeEmail: string | null;
  // Did the assignee do anything in the app since being assigned? (Our proxy for
  // "has had the chance to see the in-app notification".)
  wasActiveSinceAssigned: boolean;
}): AssignmentEmailDecision {
  if (input.currentAssigneeId !== input.targetAssigneeId) return "reassigned_away";
  if (input.assigneeDeactivated || !input.assigneeEmail) return "no_recipient";
  if (input.wasActiveSinceAssigned) return "already_active";
  return "send";
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function displayName(u: {
  name: string | null;
  display_name: string | null;
  email: string | null;
}): string {
  return (
    u.display_name?.trim() ||
    u.name?.trim() ||
    (u.email ? u.email.split("@")[0] : "") ||
    ""
  );
}

// Job handler. Returns { skipped } for every no-send so the cron marks it done;
// only "send_failed" is retried (via the queue's normal backoff).
export async function processNotifyAssignmentJob(
  payload: Record<string, unknown>,
): Promise<{ sent?: true; skipped?: string }> {
  const engagementId =
    typeof payload.engagement_id === "string" ? payload.engagement_id : "";
  const assigneeId =
    typeof payload.assignee_id === "string" ? payload.assignee_id : "";
  const assignedAt =
    typeof payload.assigned_at === "string" ? payload.assigned_at : "";
  const assignedBy =
    typeof payload.assigned_by === "string" ? payload.assigned_by : null;
  const note = typeof payload.note === "string" ? payload.note : null;
  if (!engagementId || !assigneeId || !assignedAt) return { skipped: "bad_payload" };

  const sb = getServiceRoleSupabase();

  const { data: eng } = await sb
    .from("engagements")
    .select("id, title, assigned_user_id, firm_id")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng) return { skipped: "engagement_gone" };

  const { data: assignee } = await sb
    .from("users")
    .select("id, email, name, display_name, locale, deactivated_at")
    .eq("id", assigneeId)
    .maybeSingle();

  // Proxy for "has been in the app since assigned": any activity_log action of
  // theirs after the assignment. actor_id is the assignee (the assignment
  // activity itself was logged by the ASSIGNER, so it never self-cancels).
  const { data: recentAction } = await sb
    .from("activity_log")
    .select("id")
    .eq("actor_id", assigneeId)
    .gte("created_at", assignedAt)
    .limit(1)
    .maybeSingle();

  const decision = assignmentEmailDecision({
    currentAssigneeId: (eng.assigned_user_id as string | null) ?? null,
    targetAssigneeId: assigneeId,
    assigneeDeactivated: !!assignee?.deactivated_at,
    assigneeEmail: (assignee?.email as string | null) ?? null,
    wasActiveSinceAssigned: !!recentAction,
  });
  if (decision !== "send") return { skipped: decision };

  const [firmResp, assignerResp] = await Promise.all([
    sb.from("firms").select("name").eq("id", eng.firm_id).maybeSingle(),
    assignedBy
      ? sb
          .from("users")
          .select("name, display_name, email")
          .eq("id", assignedBy)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const firmName = (firmResp.data?.name as string) ?? "";
  const assigner = assignerResp.data;
  const locale = assignee?.locale === "fr" ? "fr" : "en";

  const email = buildTeamAssignmentEmail({
    assignerName: assigner ? displayName(assigner) : firmName || "Vylan",
    firmName,
    engagementTitle: (eng.title as string) ?? "",
    note,
    url: `${appUrl()}/${locale}/engagements/${engagementId}`,
    locale,
  });
  const res = await sendEmail({
    to: assignee!.email as string,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (!res.sent) return { skipped: "send_failed" };
  return { sent: true };
}
