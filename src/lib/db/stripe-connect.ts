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
};

export type SetConnectAccountResult =
  | { ok: true }
  | { ok: false; reason: "migration_pending" | "error" };

// Persist the connected-account id the first time an accountant starts Connect
// onboarding. Service-role write (the column is not authenticated-writable).
export async function setFirmConnectAccountId(
  firmId: string,
  accountId: string,
): Promise<SetConnectAccountResult> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("firms")
    .update({ stripe_connect_account_id: accountId })
    .eq("id", firmId);
  if (error) {
    if (isMissingColumn(error)) return { ok: false, reason: "migration_pending" };
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
  const { data, error } = await sb
    .from("firms")
    .select(
      "id, stripe_connect_account_id, connect_charges_enabled, connect_payouts_enabled, connect_details_submitted, connect_onboarded_at",
    )
    .eq("stripe_connect_account_id", accountId)
    .maybeSingle();
  if (error) {
    if (!isMissingColumn(error)) {
      console.error("[stripe-connect] findFirmByConnectAccountId failed:", error);
    }
    return null;
  }
  return (data as FirmConnectRow) ?? null;
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
  const updates: Record<string, unknown> = {
    connect_charges_enabled: status.charges_enabled,
    connect_payouts_enabled: status.payouts_enabled,
    connect_details_submitted: status.details_submitted,
  };
  if (status.charges_enabled && !firm.connect_onboarded_at) {
    updates.connect_onboarded_at = new Date().toISOString();
  }
  const { error } = await sb.from("firms").update(updates).eq("id", firm.id);
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
  const { error } = await sb
    .from("firms")
    .update({
      stripe_connect_account_id: null,
      connect_charges_enabled: false,
      connect_payouts_enabled: false,
      connect_details_submitted: false,
      connect_onboarded_at: null,
    })
    .eq("id", firmId);
  if (error) {
    console.error("[stripe-connect] clearFirmConnectAccount failed:", error);
    throw error;
  }
}
