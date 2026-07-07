// QuickBooks Feature 3 — learn from the accountant's corrections (data layer).
//
// READS go through the AUTHENTICATED client (RLS firm-scoped) for user-context
// callers, or a service-role BY-firm read for background workers with no session.
// WRITES are service-role (the resolve route records a mapping when the accountant
// picks a field), exactly like the suggestions layer. Everything degrades
// gracefully (isMissingSchema) before migration 0490 lands: reads return {} and
// writes no-op, so matching just behaves as it did before (fuzzy only).

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import type { LearnedMappings, LearnSignal } from "@/lib/quickbooks/suggest";

const SELECT = "signal_type, source_key, target_qbo_id, target_qbo_name";

// Fold the flat rows into the nested { signal: { key: {id,name} } } lookup the
// matcher consumes. Skips any malformed row rather than throwing.
function rowsToMappings(
  rows: Array<Record<string, unknown>> | null,
): LearnedMappings {
  const out: LearnedMappings = {};
  for (const row of rows ?? []) {
    const signal = row.signal_type as LearnSignal | null;
    const key = row.source_key as string | null;
    const id = row.target_qbo_id as string | null;
    const name = row.target_qbo_name as string | null;
    if (!signal || !key || !id || !name) continue;
    (out[signal] ??= {})[key] = { id, name };
  }
  return out;
}

// RLS-scoped read of the caller firm's learned mappings. {} on missing table/error
// (so a user-context suggestion build degrades to fuzzy-only, never throws).
export async function readFirmLearnedMappings(): Promise<LearnedMappings> {
  const sb = await getServerSupabase();
  const res = await sb.from("quickbooks_learned_mappings").select(SELECT);
  if (res.error) {
    if (!isMissingSchema(res.error)) {
      console.error("[quickbooks] readFirmLearnedMappings failed:", res.error);
    }
    return {};
  }
  return rowsToMappings(res.data as Array<Record<string, unknown>> | null);
}

// Service-role read BY firm id, for background workers (the classify worker) with
// no authenticated session, so RLS / current_firm_id() can't scope them.
export async function readLearnedMappingsForFirm(
  firmId: string,
): Promise<LearnedMappings> {
  const sb = getServiceRoleSupabase();
  const res = await sb
    .from("quickbooks_learned_mappings")
    .select(SELECT)
    .eq("firm_id", firmId);
  if (res.error) {
    if (!isMissingSchema(res.error)) {
      console.error(
        "[quickbooks] readLearnedMappingsForFirm failed:",
        res.error,
      );
    }
    return {};
  }
  return rowsToMappings(res.data as Array<Record<string, unknown>> | null);
}

// Upsert one learned mapping (service-role — the table has no authenticated write
// grant). One remembered target per (firm, signal, key); a re-correction replaces
// it (last write wins). times_confirmed / created_at are omitted so the insert
// takes their defaults and a conflicting update leaves them untouched. Best-effort:
// a missing table (pre-0490) or error is swallowed so it never breaks the resolve
// request that triggered the learning.
export async function recordLearnedMapping(input: {
  firmId: string;
  signalType: LearnSignal;
  sourceKey: string;
  sourceSample: string;
  target: { id: string; name: string };
  reviewerId: string | null;
}): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.from("quickbooks_learned_mappings").upsert(
    {
      firm_id: input.firmId,
      signal_type: input.signalType,
      source_key: input.sourceKey,
      source_sample: input.sourceSample.slice(0, 300),
      target_qbo_id: input.target.id,
      target_qbo_name: input.target.name,
      reviewed_by: input.reviewerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "firm_id,signal_type,source_key" },
  );
  if (error && !isMissingSchema(error)) {
    console.error("[quickbooks] recordLearnedMapping failed:", error);
  }
}

// Delete ALL of a firm's learned mappings. Used when the connected QuickBooks
// COMPANY changes (different realm / sandbox->production): every learned target
// id belongs to the old company and would mis-map new documents. Service role;
// best-effort (missing table pre-0490 is a no-op).
export async function purgeFirmLearnedMappings(firmId: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("quickbooks_learned_mappings")
    .delete()
    .eq("firm_id", firmId);
  if (error && !isMissingSchema(error)) {
    console.error("[quickbooks] purgeFirmLearnedMappings failed:", error);
  }
}
