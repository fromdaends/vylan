// The automations library — reading and writing the firm's named workflow
// playbooks (migration 1560).
//
// READS DEGRADE, WRITES REFUSE, the client-members.ts shape: before 1560 is
// applied a read returns an empty library (true for that environment) and a
// write throws a plain error naming the migration.
//
// Built-ins (firm_id null) are readable by everyone and editable by no firm —
// enforced by RLS (update policy requires firm_id = caller's firm), so the
// guard here is a courtesy error message rather than the security boundary.

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { isMissingSchema } from "@/lib/db/quickbooks";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@/lib/workflow/definition";

export type Automation = {
  id: string;
  // Null = built-in, visible to every firm.
  firmId: string | null;
  name: string;
  definition: WorkflowDefinition | null;
  archivedAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  firm_id: string | null;
  name: string;
  definition: unknown;
  archived_at: string | null;
  created_at: string;
};

function toAutomation(r: Row): Automation {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    definition: parseWorkflowDefinition(r.definition),
    archivedAt: r.archived_at,
    createdAt: r.created_at,
  };
}

/** Built-ins first, then the firm's own, newest last — the picker's order. */
export async function listAutomations(): Promise<Automation[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("automations")
    .select("id, firm_id, name, definition, archived_at, created_at")
    .is("archived_at", null)
    .order("firm_id", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return ((data ?? []) as Row[]).map(toAutomation);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("automations")
    .select("id, firm_id, name, definition, archived_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  return data ? toAutomation(data as Row) : null;
}

export async function createAutomation(input: {
  name: string;
  definition: WorkflowDefinition;
}): Promise<Automation> {
  const supabase = await getServerSupabase();
  const u = await getCurrentUser();
  if (!u?.firm_id) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("automations")
    .insert({
      firm_id: u.firm_id,
      name: input.name,
      definition: input.definition,
      created_by_user_id: u.id,
    })
    .select("id, firm_id, name, definition, archived_at, created_at")
    .single();
  if (error) {
    if (isMissingSchema(error)) {
      throw new Error("Automations need a database update (migration 1560).");
    }
    throw error;
  }
  return toAutomation(data as Row);
}

export async function updateAutomation(
  id: string,
  patch: Partial<{ name: string; definition: WorkflowDefinition }>,
): Promise<Automation> {
  const supabase = await getServerSupabase();
  const existing = await getAutomation(id);
  if (!existing) throw new Error("Automation not found");
  if (existing.firmId === null) {
    // RLS already refuses this write; say why instead of returning nothing.
    throw new Error("Built-in automations can't be edited — clone one instead.");
  }
  const { data, error } = await supabase
    .from("automations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, firm_id, name, definition, archived_at, created_at")
    .single();
  if (error) throw error;
  return toAutomation(data as Row);
}

/**
 * How many templates (visible to this firm) point at each automation — the
 * list's "Used by N templates" line. Provenance display only; behaviour never
 * reads through these pointers.
 */
export async function listAutomationTemplateUseCounts(): Promise<
  Record<string, number>
> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("templates")
    .select("automation_id")
    .not("automation_id", "is", null);
  if (error) {
    if (isMissingSchema(error)) return {};
    throw error;
  }
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { automation_id: string }[]) {
    counts[r.automation_id] = (counts[r.automation_id] ?? 0) + 1;
  }
  return counts;
}

/** Retire, never delete: past engagements' provenance keeps pointing here. */
export async function archiveAutomation(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("automations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
