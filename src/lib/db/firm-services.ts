// The firm's service catalogue (migration 1480).
//
// What the firm SELLS, defined once and dropped onto any engagement. A service
// is a TEMPLATE for an engagement item, not a live one: using it COPIES its
// values onto the engagement, which the accountant may then change for that
// client without touching the catalogue.
//
// That copy-on-use is deliberate and load-bearing. If an engagement item read
// its price through a foreign key, editing a service would silently rewrite
// every proposal that referenced it — including ones a client has already
// agreed to. Provenance is recorded (engagement_items.service_id); values are
// not read through.

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { isMissingSchema } from "@/lib/db/quickbooks";
import type { BillingFrequency, RateType } from "@/lib/engagements/items";

export type FirmService = {
  id: string;
  name: string;
  description: string | null;
  rateCents: number | null;
  rateType: RateType;
  billingFrequency: BillingFrequency;
  taxPct: number | null;
  /**
   * The work this service implies (1620) — a task template id, or null.
   *
   * A LIVE reference from the catalogue, so improving the template improves
   * what every future engagement gets. The tasks are COPIED onto an engagement
   * when the service is used, so editing it never rewrites a job under way.
   */
  taskTemplateId: string | null;
  archivedAt: string | null;
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  rate_cents: number | null;
  task_template_id?: string | null;
  rate_type: RateType;
  billing_frequency: BillingFrequency;
  tax_pct: number | string | null;
  archived_at: string | null;
};

function toService(r: Row): FirmService {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    rateCents: r.rate_cents,
    rateType: r.rate_type,
    billingFrequency: r.billing_frequency,
    // Postgres numeric comes back as a STRING through PostgREST. Left as a
    // number here so nothing downstream has to remember that.
    taxPct: r.tax_pct == null ? null : Number(r.tax_pct),
    // Absent before 1620 is applied, which reads as "carries no work" — the
    // catalogue keeps working, it simply pulls no tasks.
    taskTemplateId: r.task_template_id ?? null,
    archivedAt: r.archived_at,
  };
}

/**
 * The firm's live services, in display order.
 *
 * Degrades to an empty list before migration 1480 is applied — the catalogue is
 * simply not offered yet, and every screen that uses it is written to treat
 * "no services" as an ordinary state rather than an error.
 */
export async function listFirmServices(
  opts: { includeArchived?: boolean } = {},
): Promise<FirmService[]> {
  const supabase = await getServerSupabase();
  let q = supabase
    .from("firm_services")
    .select(
      "id, name, description, rate_cents, rate_type, billing_frequency, tax_pct, task_template_id, archived_at",
    )
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });
  if (!opts.includeArchived) q = q.is("archived_at", null);

  const { data, error } = await q;
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[firm-services] list failed:", error);
    }
    return [];
  }
  return (data as Row[]).map(toService);
}

export type FirmServiceInput = {
  name: string;
  description: string | null;
  rateCents: number | null;
  rateType: RateType;
  billingFrequency: BillingFrequency;
  taxPct: number | null;
  /** Null clears the link — a service that carries no work is normal. */
  taskTemplateId?: string | null;
};

export async function createFirmService(
  input: FirmServiceInput,
): Promise<{ ok: true; id: string } | { ok: false; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false };

  const { data, error } = await supabase
    .from("firm_services")
    .insert({
      firm_id: user.firm_id,
      name: input.name,
      description: input.description,
      rate_cents: input.rateCents,
      rate_type: input.rateType,
      billing_frequency: input.billingFrequency,
      tax_pct: input.taxPct,
      // Only when set, so a database without 1620 keeps saving services that
      // carry no work rather than failing outright.
      ...(input.taskTemplateId !== undefined
        ? { task_template_id: input.taskTemplateId }
        : {}),
      created_by_user_id: user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[firm-services] create failed:", error);
    return { ok: false };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateFirmService(
  id: string,
  input: FirmServiceInput,
): Promise<{ ok: boolean; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("firm_services")
    .update({
      name: input.name,
      description: input.description,
      rate_cents: input.rateCents,
      rate_type: input.rateType,
      billing_frequency: input.billingFrequency,
      tax_pct: input.taxPct,
      // Only when set, so a database without 1620 keeps saving services that
      // carry no work rather than failing outright.
      ...(input.taskTemplateId !== undefined
        ? { task_template_id: input.taskTemplateId }
        : {}),
    })
    .eq("id", id);

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[firm-services] update failed:", error);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Retire a service. NOT a delete.
 *
 * A service that has been used is part of the history of every engagement that
 * used it. Hard-deleting would leave those lines describing something nobody can
 * look up. Archived services stop being offered in pickers and nothing else
 * changes.
 */
export async function archiveFirmService(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("firm_services")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[firm-services] archive failed:", error);
    return { ok: false };
  }
  return { ok: true };
}
