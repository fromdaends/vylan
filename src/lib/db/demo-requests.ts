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
  // Landing-page lead form fields (migration 0160). NULL for leads that
  // came through the multi-step /demo flow.
  practice_type: string | null;
  active_clients: string | null;
  notes: string | null;
  source: string | null;
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

// Landing marketing-site lead form. Unlike the /demo flow this is a
// single submit, so it's one insert with everything we collected (no
// progressive save). Writes to the SAME demo_requests table so leads
// land in one place and reuse the founder-notification + cron infra.
export type CreateFirmLeadInput = {
  email: string;
  firm_name: string;
  practice_type: string;
  active_clients: string;
  notes: string | null;
};

export async function createFirmLead(
  input: CreateFirmLeadInput,
): Promise<DemoRequest | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("demo_requests")
    .insert({
      email: input.email,
      firm_name: input.firm_name,
      practice_type: input.practice_type,
      active_clients: input.active_clients,
      notes: input.notes,
      source: "landing_form",
      // A single-step form is a complete lead, so mark furthest_step 3
      // (reads as "qualified" in the funnel metric) and stamp
      // notified_at up front so the /api/cron/demo-leads debounce job
      // never double-emails it — the action sends its own founder email
      // immediately via after().
      furthest_step: 3,
      notified_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) {
    console.error("[demo-requests] createFirmLead failed:", error);
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
