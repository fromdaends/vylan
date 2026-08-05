"use server";

// The firm's standard terms of service (migration 1610).
//
// The founder: "shouldnt general terms fill automatically? Like a preset
// loaded". Yes — a firm's terms are the same on every engagement, and retyping
// them into each template is the exact work a template exists to remove.
//
// Edited from INSIDE the template builder rather than from Settings, which was
// the founder's call: you set it at the moment you notice you need it, and
// Settings is being rewritten by another session.
//
// Only async exports live here — a `"use server"` module that exports anything
// else fails the production build, and nothing else in the toolchain catches it.

import { z } from "zod";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

const Schema = z.object({ terms: z.string().trim().max(20000) });

export type FirmTermsResult = {
  ok: boolean;
  error?: "no_session" | "not_allowed" | "invalid" | "needs_migration" | "failed";
};

export async function saveFirmDefaultTermsAction(
  input: z.input<typeof Schema>,
): Promise<FirmTermsResult> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  // The firm's standard terms are a FIRM decision — the same gate the service
  // catalogue uses. Anyone can write terms onto one template; changing what
  // every future template starts from is not the same act.
  if (!can(user, "firm.settings")) return { ok: false, error: "not_allowed" };

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("firms")
    .update({ default_engagement_terms: parsed.data.terms || null })
    .eq("id", user.firm_id);

  if (error) {
    if (isMissingSchema(error)) return { ok: false, error: "needs_migration" };
    console.error("[firm-terms] save failed:", error);
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}
