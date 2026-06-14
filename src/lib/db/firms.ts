import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

export type Firm = {
  id: string;
  name: string;
  locale_default: "fr" | "en";
  logo_url: string | null;
  brand_color: string;
  timezone: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  plan: "trial" | "solo" | "cabinet" | "cabinet_plus";
  // Per-firm seat-cap override (migration 0190). NULL = use the plan's
  // maxUsers; a positive value wins over the plan (resolveSeatCap). Service-
  // role-only — deliberately NOT in the authenticated UPDATE whitelist.
  seat_cap_override: number | null;
  onboarded_at: string | null;
  invited_emails: string[];
  business_hours: Record<string, unknown>;
  auto_reject_unusable_docs: boolean;
  // SEPARATE from auto_reject_unusable_docs (migration 0270): when ON, an
  // exact-duplicate upload is auto-rejected; when OFF it is only flagged.
  auto_reject_duplicates: boolean;
  // SEPARATE again (migration 0330): when ON, a confidently-missing page in a
  // multi-page document makes Vylan auto-ask the client to send it; when OFF the
  // missing page is only flagged for the accountant. May be undefined at runtime
  // until 0330 is applied — readers default it to false (OFF).
  auto_request_missing_pages: boolean;
  // Firm-wide include/exclude for the Quebec-only tax forms — the RL slips
  // (migration 0350). When false, those slips are hidden from every client
  // checklist regardless of the client's province; when true (default), the
  // per-client province filter still applies. May be undefined at runtime until
  // 0350 is applied — readers default it to true (include).
  include_quebec_forms: boolean;
  // Per-firm monthly AI-check cap (migration 0230). Service-role-only — not in
  // the updateCurrentFirm whitelist. May be undefined at runtime until 0230 is
  // applied; getFirmAiUsage defaults it to 400.
  ai_monthly_cap: number;
  is_demo: boolean;
  created_at: string;
};

// React.cache() so multiple layouts/pages/components only hit the
// firms row once per render.
export const getCurrentFirm = cache(async function _getCurrentFirm(): Promise<Firm | null> {
  const supabase = await getServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;

  const { data: u } = await supabase
    .from("users")
    .select("firm_id")
    .eq("id", user.user.id)
    .maybeSingle();
  if (!u?.firm_id) return null;

  const { data: firm } = await supabase
    .from("firms")
    .select("*")
    .eq("id", u.firm_id)
    .maybeSingle();
  return (firm as Firm) ?? null;
});

export async function updateCurrentFirm(
  patch: Partial<
    Pick<
      Firm,
      | "name"
      | "locale_default"
      | "brand_color"
      | "timezone"
      | "business_hours"
      | "invited_emails"
      | "onboarded_at"
      | "auto_reject_unusable_docs"
      | "auto_reject_duplicates"
      | "auto_request_missing_pages"
      | "include_quebec_forms"
      | "logo_url"
    >
  >,
): Promise<Firm> {
  const supabase = await getServerSupabase();
  const firm = await getCurrentFirm();
  if (!firm) throw new Error("No firm for current user");

  const { data, error } = await supabase
    .from("firms")
    .update(patch)
    .eq("id", firm.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Firm;
}
