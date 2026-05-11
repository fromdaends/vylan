import { getServerSupabase } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  role: "owner" | "staff";
  locale: "fr" | "en";
  created_at: string;
};

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const { data: row } = await supabase
    .from("users")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  return (row as AppUser) ?? null;
}
