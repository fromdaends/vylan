"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { checkRateLimit, FEEDBACK_PER_USER } from "@/lib/rate-limit";
import { sendEmail, escapeHtml } from "@/lib/email";
import { brand } from "@/lib/brand";

export type FeedbackState =
  | { ok?: true; error?: undefined }
  | { ok?: false; error: string }
  | null;

const FeedbackSchema = z.object({
  message: z.string().min(3, "min_3_chars").max(2000, "too_long"),
  page_url: z.string().optional().nullable(),
});

export async function submitFeedbackAction(
  _prev: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const parsed = FeedbackSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { ok: false, error: "unauthorized" };
  }
  const rl = await checkRateLimit({
    key: `feedback:user:${auth.user.id}`,
    ...FEEDBACK_PER_USER,
  });
  if (!rl.ok) {
    return { ok: false, error: "rate_limited" };
  }
  const firm = await getCurrentFirm();
  const h = await headers();
  const userAgent = h.get("user-agent") ?? null;
  const { error } = await supabase.from("feedback").insert({
    firm_id: firm?.id ?? null,
    user_id: auth.user.id,
    message: parsed.data.message.trim(),
    page_url: parsed.data.page_url ?? null,
    user_agent: userAgent,
  });
  if (error) {
    console.error("[submitFeedbackAction]", error);
    return { ok: false, error: "save_failed" };
  }

  // Notify the team by email. The row above is the durable record, so this is
  // best-effort: a send failure is logged but never fails the action (the
  // feedback is already saved). Goes to FOUNDER_NOTIFY_EMAIL if set, otherwise
  // brand.supportEmail (hello@vylan.app). Reply-To is the submitter so a reply
  // lands straight in their inbox.
  try {
    const to = process.env.FOUNDER_NOTIFY_EMAIL?.trim() || brand.supportEmail;
    const message = parsed.data.message.trim();
    const fromUser = auth.user.email ?? "(no email on account)";
    const firmName = firm?.name ?? "(no firm)";
    const pageUrl = parsed.data.page_url ?? "(unknown)";
    const meta: [string, string][] = [
      ["From", fromUser],
      ["Firm", firmName],
      ["Page", pageUrl],
      ["Browser", userAgent ?? "—"],
    ];
    await sendEmail({
      to,
      // Send FROM a distinct address (not hello@→hello@) so Gmail/Workspace
      // doesn't treat the notification as a suspicious self-send and spam-file
      // it. Any local-part on the verified vylan.app domain is authorised.
      from: "Vylan <notifications@vylan.app>",
      subject: `Vylan feedback — ${firmName}`,
      replyTo: auth.user.email ?? undefined,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h2 style="margin:0 0 12px;font-size:18px">New feedback</h2>
  <div style="white-space:pre-wrap;font-size:15px;line-height:1.6;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px">${escapeHtml(message)}</div>
  <table style="margin-top:16px;font-size:13px;color:#475569;border-collapse:collapse">
    ${meta
      .map(
        ([k, v]) =>
          `<tr><td style="padding:2px 14px 2px 0;color:#94a3b8">${k}</td><td>${escapeHtml(v)}</td></tr>`,
      )
      .join("")}
  </table>
</div>`,
      text: `New feedback\n\n${message}\n\nFrom: ${fromUser}\nFirm: ${firmName}\nPage: ${pageUrl}\nBrowser: ${userAgent ?? "—"}`,
    });
  } catch (e) {
    console.error("[submitFeedbackAction] notification email failed:", e);
  }

  return { ok: true };
}
