// Service-role data layer for Stripe Connect (Standard) onboarding.
//
// The firms.stripe_connect_account_id + connect_* columns are NOT in the
// authenticated UPDATE whitelist (migration 0370 / 0039), so every write here
// goes through the service-role client. Reads used by the Connect webhook also
// use the service role because the webhook has no user session.
//
// Everything degrades gracefully before migration 0370 is applied to the remote
// DB (dev uses remote Supabase, no local Docker): a missing-column error is
// reported back as a typed result so callers can show a clean "apply the
// migration" message instead of a 500.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { stripe, stripeKeyMode } from "@/lib/stripe";

// PostgREST surfaces an unknown column as PGRST204 (schema-cache miss after a
// not-yet-applied migration) or the Postgres 42703 "undefined_column".
function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /column .* does not exist/i.test(err.message ?? "") ||
    /connect_|stripe_connect_account_id/i.test(err.message ?? "")
  );
}

export type FirmConnectRow = {
  id: string;
  stripe_connect_account_id: string | null;
  connect_charges_enabled: boolean;
  connect_payouts_enabled: boolean;
  connect_details_submitted: boolean;
  connect_onboarded_at: string | null;
  stripe_connect_mode: "test" | "live" | null;
};

export type SetConnectAccountResult =
  | { ok: true }
  | { ok: false; reason: "migration_pending" | "error" | "would_clobber_live" };

// Persist the connected-account id the first time an accountant starts Connect
// onboarding. Service-role write (the column is not authenticated-writable).
// Also stamps the Stripe MODE this connection was made in, and refuses to let a
// TEST-mode environment overwrite a firm already connected in LIVE mode — the
// dev-clobbers-prod hazard created by dev and prod sharing one database.
export async function setFirmConnectAccountId(
  firmId: string,
  accountId: string,
): Promise<SetConnectAccountResult> {
  const sb = getServiceRoleSupabase();
  const mode = stripeKeyMode();

  // Anti-clobber: never let a test-mode connect blow away a live connection.
  const { data: existing } = await sb
    .from("firms")
    .select("stripe_connect_account_id, stripe_connect_mode")
    .eq("id", firmId)
    .maybeSingle();
  if (
    existing?.stripe_connect_account_id &&
    (existing as { stripe_connect_mode?: string | null }).stripe_connect_mode ===
      "live" &&
    mode === "test"
  ) {
    console.warn(
      "[stripe-connect] refused: a test-mode connect would clobber the live connection for firm",
      firmId,
    );
    return { ok: false, reason: "would_clobber_live" };
  }

  const { error } = await sb
    .from("firms")
    .update({ stripe_connect_account_id: accountId, stripe_connect_mode: mode })
    .eq("id", firmId);
  // Pre-0660: retry WITHOUT the mode column so onboarding still works (the mode
  // is simply unrecorded until the migration lands).
  if (error && isMissingColumn(error)) {
    const retry = await sb
      .from("firms")
      .update({ stripe_connect_account_id: accountId })
      .eq("id", firmId);
    if (!retry.error) return { ok: true };
    if (isMissingColumn(retry.error))
      return { ok: false, reason: "migration_pending" };
    console.error("[stripe-connect] setFirmConnectAccountId failed:", retry.error);
    return { ok: false, reason: "error" };
  }
  if (error) {
    console.error("[stripe-connect] setFirmConnectAccountId failed:", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

// Forge-proof firm lookup for the Connect webhook: resolve a firm by its
// connected-account id (the same trusted-link pattern the subscription webhook
// uses for stripe_customer_id). Returns null on any error/missing column so the
// webhook no-ops rather than throwing.
export async function findFirmByConnectAccountId(
  accountId: string,
): Promise<FirmConnectRow | null> {
  const sb = getServiceRoleSupabase();
  const base =
    "id, stripe_connect_account_id, connect_charges_enabled, connect_payouts_enabled, connect_details_submitted, connect_onboarded_at";
  let { data, error } = await sb
    .from("firms")
    .select(`${base}, stripe_connect_mode`)
    .eq("stripe_connect_account_id", accountId)
    .maybeSingle();
  // Pre-0660: the mode column doesn't exist yet — retry without it so the webhook
  // still resolves the firm (mode defaults to null / unknown).
  if (error && isMissingColumn(error)) {
    ({ data, error } = await sb
      .from("firms")
      .select(base)
      .eq("stripe_connect_account_id", accountId)
      .maybeSingle());
  }
  if (error) {
    if (!isMissingColumn(error)) {
      console.error("[stripe-connect] findFirmByConnectAccountId failed:", error);
    }
    return null;
  }
  if (!data) return null;
  const row = data as FirmConnectRow;
  // Fallback select (pre-0660) omits the column — default it to null at runtime.
  return { ...row, stripe_connect_mode: row.stripe_connect_mode ?? null };
}

// Apply Stripe's authoritative account capabilities to the firm row. Called by
// the Connect webhook on account.updated. connect_onboarded_at is stamped only
// once — the first time charges become enabled — so it records when the firm
// became able to receive payments.
export async function applyConnectAccountStatus(
  firm: FirmConnectRow,
  status: {
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
  },
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const mode = stripeKeyMode();

  // Anti-mutate: a TEST-mode environment must not overwrite the status of a firm
  // connected in LIVE mode (dev and prod share one DB). Without this, a stray
  // test-mode sync could flip a live firm's connect_charges_enabled and break
  // real payments. (The retrieve in syncFirmConnectStatusFromStripe usually fails
  // first for a cross-mode account, but this closes the gap for the webhook.)
  if (firm.stripe_connect_mode === "live" && mode === "test") {
    console.warn(
      "[stripe-connect] skipped: a test-mode status write would overwrite the live connection for firm",
      firm.id,
    );
    return;
  }

  const updates: Record<string, unknown> = {
    connect_charges_enabled: status.charges_enabled,
    connect_payouts_enabled: status.payouts_enabled,
    connect_details_submitted: status.details_submitted,
    stripe_connect_mode: mode,
  };
  if (status.charges_enabled && !firm.connect_onboarded_at) {
    updates.connect_onboarded_at = new Date().toISOString();
  }
  let { error } = await sb.from("firms").update(updates).eq("id", firm.id);
  // Pre-0660: retry WITHOUT the mode column so status syncs keep working.
  if (error && isMissingColumn(error)) {
    const { stripe_connect_mode: _drop, ...withoutMode } = updates;
    void _drop;
    ({ error } = await sb.from("firms").update(withoutMode).eq("id", firm.id));
  }
  if (error) {
    console.error("[stripe-connect] applyConnectAccountStatus failed:", error);
    throw error;
  }
}

// Stripe told us the platform was deauthorized for this connected account
// (the accountant disconnected Vylan). Reset the firm so the UI shows the
// "connect" state again and no payment can be attempted.
export async function clearFirmConnectAccount(firmId: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const reset = {
    stripe_connect_account_id: null,
    connect_charges_enabled: false,
    connect_payouts_enabled: false,
    connect_details_submitted: false,
    connect_onboarded_at: null,
  };
  let { error } = await sb
    .from("firms")
    .update({ ...reset, stripe_connect_mode: null })
    .eq("id", firmId);
  // Pre-0660: retry without the mode column.
  if (error && isMissingColumn(error)) {
    ({ error } = await sb.from("firms").update(reset).eq("id", firmId));
  }
  if (error) {
    console.error("[stripe-connect] clearFirmConnectAccount failed:", error);
    throw error;
  }
}

// Pull the live account status straight from Stripe and persist it — so the
// "Connected" state doesn't depend on the account.updated webhook arriving. Used
// when the firm has a connected account but charges aren't enabled yet (the
// "Almost there" state), e.g. right after returning from onboarding. Returns the
// refreshed row (or the original on any Stripe error) so the caller can render
// the up-to-date status immediately.
export async function syncFirmConnectStatusFromStripe(
  accountId: string,
): Promise<FirmConnectRow | null> {
  const firm = await findFirmByConnectAccountId(accountId);
  if (!firm) return null;
  const s = stripe();
  if (!s) return firm;
  let account;
  try {
    account = await s.accounts.retrieve(accountId);
  } catch (e) {
    console.error("[stripe-connect] sync retrieve failed:", e);
    return firm;
  }
  const status = {
    charges_enabled: account.charges_enabled === true,
    payouts_enabled: account.payouts_enabled === true,
    details_submitted: account.details_submitted === true,
  };
  try {
    await applyConnectAccountStatus(firm, status);
  } catch {
    // Best-effort persist; still return the live status to the caller.
  }
  return {
    ...firm,
    connect_charges_enabled: status.charges_enabled,
    connect_payouts_enabled: status.payouts_enabled,
    connect_details_submitted: status.details_submitted,
    // We just retrieved this account with THIS env's key, so its mode is the
    // env's mode (applyConnectAccountStatus persisted the same).
    stripe_connect_mode: stripeKeyMode() ?? firm.stripe_connect_mode,
  };
}
