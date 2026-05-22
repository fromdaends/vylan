// Public demo-form leads. Service-role client only — this table is
// intentionally not firm-scoped and is invisible to the anon +
// authenticated roles (see 0099_demo_requests.sql).
//
// The progressive-save flow is:
//   1. Step 1 submitted -> createDemoRequest({...step1, furthest_step: 1})
//      returns the new row's id.
//   2. Step 2 submitted -> updateDemoRequest(id, {...step2, furthest_step: 2})
//   3. Step 3 submitted -> updateDemoRequest(id, {...step3, furthest_step: 3})
//   4. cal.com booking confirms -> updateDemoRequest(id, { booked_at: ... })

import { getServiceRoleSupabase } from "@/lib/supabase/server";

export type FirmSize = "solo" | "2_5" | "6_15" | "16_plus";
export type ClientVolume =
  | "under_25"
  | "25_100"
  | "100_300"
  | "300_plus";
export type CurrentTool =
  | "manual_email"
  | "taxdome"
  | "karbon"
  | "other_software"
  | "nothing";

export type DemoRequest = {
  id: string;
  contact_name: string | null;
  email: string;
  firm_name: string | null;
  firm_size: FirmSize | null;
  client_volume: ClientVolume | null;
  current_tool: CurrentTool | null;
  current_tool_other: string | null;
  phone: string | null;
  province: string | null;
  preferred_language: "fr" | "en" | null;
  marketing_opt_in: boolean;
  furthest_step: 1 | 2 | 3;
  booked_at: string | null;
  notified_at: string | null;
  notion_page_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateDemoRequestInput = {
  contact_name: string;
  email: string;
  firm_name: string;
};

export type UpdateDemoRequestPatch = Partial<{
  contact_name: string | null;
  email: string;
  firm_name: string | null;
  firm_size: FirmSize;
  client_volume: ClientVolume;
  current_tool: CurrentTool;
  current_tool_other: string | null;
  phone: string | null;
  province: string;
  preferred_language: "fr" | "en";
  marketing_opt_in: boolean;
  furthest_step: 1 | 2 | 3;
  booked_at: string | null;
  notified_at: string | null;
  notion_page_id: string | null;
}>;

export async function createDemoRequest(
  input: CreateDemoRequestInput,
): Promise<DemoRequest | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("demo_requests")
    .insert({
      contact_name: input.contact_name,
      email: input.email,
      firm_name: input.firm_name,
      furthest_step: 1,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[demo-requests] createDemoRequest failed:", error);
    return null;
  }
  return data as DemoRequest;
}

export async function updateDemoRequest(
  id: string,
  patch: UpdateDemoRequestPatch,
): Promise<DemoRequest | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("demo_requests")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[demo-requests] updateDemoRequest failed:", error);
    return null;
  }
  return data as DemoRequest;
}

export async function getDemoRequest(id: string): Promise<DemoRequest | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("demo_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[demo-requests] getDemoRequest failed:", error);
    return null;
  }
  return (data as DemoRequest) ?? null;
}
