"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { checkRateLimit, FEEDBACK_PER_USER } from "@/lib/rate-limit";

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
  return { ok: true };
}
