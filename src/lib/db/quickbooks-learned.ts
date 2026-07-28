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
import {
  isFirmLevelScope,
  isMissingSchema,
  runWithClientFallback,
  withClientScope,
  type QuickbooksClientScope,
} from "@/lib/db/quickbooks";
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
export async function readFirmLearnedMappings(
  clientId?: QuickbooksClientScope,
): Promise<LearnedMappings> {
  const sb = await getServerSupabase();
  const base = () => sb.from("quickbooks_learned_mappings").select(SELECT);
  const res = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId),
    () => base(),
  );
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
  clientId?: QuickbooksClientScope,
): Promise<LearnedMappings> {
  const sb = getServiceRoleSupabase();
  const base = () =>
    sb.from("quickbooks_learned_mappings").select(SELECT).eq("firm_id", firmId);
  const res = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId),
    () => base(),
  );
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
// it (last write wins). times_confirmed counts re-confirmations of the SAME
// target and resets when the answer changes; created_at is omitted so the
// insert takes its default and a conflicting update leaves it untouched. Best-effort:
// a missing table (pre-0490) or error is swallowed so it never breaks the resolve
// request that triggered the learning.
export async function recordLearnedMapping(input: {
  firmId: string;
  clientId?: QuickbooksClientScope;
  signalType: LearnSignal;
  sourceKey: string;
  sourceSample: string;
  target: { id: string; name: string };
  reviewerId: string | null;
}): Promise<void> {
  const sb = getServiceRoleSupabase();
  // undefined/null both mean the firm-level mapping (client_id NULL).
  const clientValue = input.clientId ?? null;
  // How many times a human has confirmed THIS mapping. 0490 created the column
  // and left it unused ("reserved"); auto-approve needs it, because a mapping
  // seen once is a sighting and a mapping seen three times is a habit.
  //
  // Read-then-write rather than a SQL expression: PostgREST upsert cannot
  // increment in place, and losing the odd count to a race is harmless for a
  // confidence counter (it delays unattended approval by one document, which
  // is the safe direction to be wrong in).
  let nextConfirmed = 1;
  {
    // CLIENT-SCOPED, like every other read here — reading the count off another
    // client's row would let one client's habit unlock unattended approval for
    // a different one.
    const { data: prior } = await withClientScope(
      sb
        .from("quickbooks_learned_mappings")
        .select("times_confirmed, target_qbo_id")
        .eq("firm_id", input.firmId)
        .eq("signal_type", input.signalType)
        .eq("source_key", input.sourceKey),
      clientValue,
    )
      .limit(1)
      .maybeSingle();
    const row = prior as
      | { times_confirmed: number | null; target_qbo_id: string | null }
      | null;
    // Only a re-confirmation of the SAME target counts. Changing the answer
    // resets the count to 1 — the accountant just corrected us, so the new
    // mapping has been confirmed exactly once and must earn trust again.
    if (row && row.target_qbo_id === input.target.id) {
      nextConfirmed = (row.times_confirmed ?? 1) + 1;
    }
  }
  const run = async (useClientId: boolean): Promise<{ schemaMiss: boolean }> => {
    const onConflict = useClientId
      ? "firm_id,client_id,signal_type,source_key"
      : "firm_id,signal_type,source_key";
    const { error } = await sb.from("quickbooks_learned_mappings").upsert(
      {
        firm_id: input.firmId,
        ...(useClientId ? { client_id: clientValue } : {}),
        signal_type: input.signalType,
        source_key: input.sourceKey,
        source_sample: input.sourceSample.slice(0, 300),
        target_qbo_id: input.target.id,
        target_qbo_name: input.target.name,
        times_confirmed: nextConfirmed,
        reviewed_by: input.reviewerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict },
    );
    if (error && isMissingSchema(error)) return { schemaMiss: true };
    if (error) {
      console.error("[quickbooks] recordLearnedMapping failed:", error);
    }
    return { schemaMiss: false };
  };

  // PRIMARY (post-0710): client-inclusive conflict target with client_id set.
  // FALLBACK (pre-0710, client_id column absent): record firm-only — but ONLY for a
  // firm-level scope. For a specific client, skip it (it would write to the firm's
  // mappings); the primary already no-op'd on the missing column.
  const primary = await run(true);
  if (primary.schemaMiss && isFirmLevelScope(input.clientId)) await run(false);
}

// Delete ALL of a firm's learned mappings. Used when the connected QuickBooks
// COMPANY changes (different realm / sandbox->production): every learned target
// id belongs to the old company and would mis-map new documents. Service role;
// best-effort (missing table pre-0490 is a no-op).
export async function purgeFirmLearnedMappings(
  firmId: string,
  clientId?: QuickbooksClientScope,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const base = () =>
    sb.from("quickbooks_learned_mappings").delete().eq("firm_id", firmId);
  const { error } = await runWithClientFallback(
    clientId,
    () => withClientScope(base(), clientId),
    () => base(),
  );
  if (error && !isMissingSchema(error)) {
    console.error("[quickbooks] purgeFirmLearnedMappings failed:", error);
  }
}

// The LOWEST confirmation count across the mappings a draft leaned on.
//
// Auto-approve is gated on this, and it takes the minimum on purpose: a draft
// is only as trustworthy as its least-established mapping. A vendor confirmed
// twenty times paired with an account confirmed once is a draft with a
// once-confirmed account in it.
//
// Returns 0 (never auto-approve) on any error or pre-0490, so a missing table
// can never accidentally unlock unattended approval.
export async function readLearnedConfirmations(
  firmId: string,
  clientId: QuickbooksClientScope,
  signals: Array<{ signalType: LearnSignal; sourceKey: string }>,
): Promise<number> {
  if (signals.length === 0) return 0;
  const sb = getServiceRoleSupabase();
  try {
    const { data, error } = await withClientScope(
      sb
        .from("quickbooks_learned_mappings")
        .select("signal_type, source_key, times_confirmed")
        .eq("firm_id", firmId)
        .in(
          "signal_type",
          signals.map((s) => s.signalType),
        )
        .in(
          "source_key",
          signals.map((s) => s.sourceKey),
        ),
      clientId,
    );
    if (error || !data) return 0;
    const byKey = new Map<string, number>();
    for (const r of data) {
      const row = r as {
        signal_type: string;
        source_key: string;
        times_confirmed: number | null;
      };
      byKey.set(`${row.signal_type}|${row.source_key}`, row.times_confirmed ?? 0);
    }
    let min = Infinity;
    for (const s of signals) {
      // A signal with NO row has never been confirmed — that alone must block.
      min = Math.min(min, byKey.get(`${s.signalType}|${s.sourceKey}`) ?? 0);
    }
    return Number.isFinite(min) ? min : 0;
  } catch {
    return 0;
  }
}
