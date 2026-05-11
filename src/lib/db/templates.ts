import { getServerSupabase } from "@/lib/supabase/server";

export type EngagementType = "t1" | "t2" | "bookkeeping" | "custom";

export type DocType =
  | "t4" | "rl1" | "t5" | "rl3" | "t3" | "rl16" | "noa"
  | "bank_statement" | "credit_card_statement" | "receipt"
  | "t2202" | "rrsp" | "medical" | "donation" | "rental"
  | "gst_hst_qst" | "trial_balance" | "gl_export" | "financials"
  | "shareholder_loan" | "payroll_summary" | "capital_asset"
  | "inventory" | "invoice" | "other";

export type TemplateItem = {
  label_fr: string;
  label_en: string;
  description_fr?: string | null;
  description_en?: string | null;
  doc_type: DocType;
  required: boolean;
};

export type Template = {
  id: string;
  firm_id: string | null;
  name: string;
  type: EngagementType;
  items: TemplateItem[];
  created_at: string;
};

export async function listTemplates(): Promise<Template[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .order("firm_id", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Template[];
}

export async function getTemplate(id: string): Promise<Template | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Template) ?? null;
}

export async function cloneTemplateToFirm(
  templateId: string,
  newName?: string,
): Promise<Template> {
  const supabase = await getServerSupabase();
  const source = await getTemplate(templateId);
  if (!source) throw new Error("Template not found");
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not authenticated");
  const { data: u } = await supabase
    .from("users")
    .select("firm_id")
    .eq("id", user.user.id)
    .single();
  if (!u?.firm_id) throw new Error("No firm for user");

  const { data, error } = await supabase
    .from("templates")
    .insert({
      firm_id: u.firm_id,
      name: newName ?? `${source.name} (copie)`,
      type: source.type,
      items: source.items,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Template;
}

export async function updateTemplate(
  id: string,
  patch: Partial<Pick<Template, "name" | "items">>,
): Promise<Template> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("templates")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Template;
}

export async function deleteTemplate(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) throw error;
}
