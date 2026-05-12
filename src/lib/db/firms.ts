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
  onboarded_at: string | null;
  invited_emails: string[];
  business_hours: Record<string, unknown>;
  created_at: string;
};

export async function getCurrentFirm(): Promise<Firm | null> {
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
}

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
