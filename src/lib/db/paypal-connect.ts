// Service-role data layer for the firm's PayPal connection (migration 0730),
// the PayPal sibling of lib/db/stripe-connect.ts. The firms.paypal_* columns
// are NOT in the authenticated UPDATE whitelist (0039/0730), so every write
// goes through the service role.
//
// No pre-0730 unknown-column fallbacks here, deliberately: 0730 was applied to
// the (shared dev/prod) database BEFORE any of this code shipped, so a missing
// column is a real error, not a deploy window.
//
// Same dev-shares-prod-DB protection as Stripe (0680): connections are stamped
// with the PayPal environment they were made in, and a SANDBOX environment may
// never overwrite a LIVE connection.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { paypalEnvironment } from "@/lib/paypal/config";
import { getSellerIntegrationStatus } from "@/lib/paypal/onboarding";

export type FirmPayPalRow = {
  id: string;
  paypal_merchant_id: string | null;
  paypal_payments_receivable: boolean;
  paypal_email_confirmed: boolean;
  paypal_connected_at: string | null;
  paypal_mode: "sandbox" | "live" | null;
};

const COLS =
  "id, paypal_merchant_id, paypal_payments_receivable, paypal_email_confirmed, paypal_connected_at, paypal_mode";

export type SetPayPalConnectionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "would_clobber_live" | "already_linked" | "error";
    };

// Persist the seller's merchant id when onboarding completes. Refuses to let a
// SANDBOX environment overwrite a firm already connected LIVE; surfaces the
// unique-index rejection (same PayPal account on another firm) as its own
// reason so the UI can say something honest.
export async function setFirmPayPalConnection(
  firmId: string,
  merchantId: string,
): Promise<SetPayPalConnectionResult> {
  const sb = getServiceRoleSupabase();
  const mode = paypalEnvironment();

  const { data: existing } = await sb
    .from("firms")
    .select("paypal_merchant_id, paypal_mode")
    .eq("id", firmId)
    .maybeSingle();
  if (
    existing?.paypal_merchant_id &&
    (existing as { paypal_mode?: string | null }).paypal_mode === "live" &&
    mode === "sandbox"
  ) {
    console.warn(
      "[paypal-connect] refused: a sandbox connect would clobber the live connection for firm",
      firmId,
    );
    return { ok: false, reason: "would_clobber_live" };
  }

  const { error } = await sb
    .from("firms")
    .update({ paypal_merchant_id: merchantId, paypal_mode: mode })
    .eq("id", firmId);
  if (error) {
    // 23505 = the partial unique index (0730): this PayPal account is already
    // attached to a different firm.
    if (error.code === "23505") return { ok: false, reason: "already_linked" };
    console.error("[paypal-connect] setFirmPayPalConnection failed:", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

// Apply PayPal's authoritative seller flags. paypal_connected_at is stamped
// only once — the first time the account becomes able to receive payments —
// mirroring connect_onboarded_at.
export async function applyPayPalSellerStatus(
  firm: Pick<FirmPayPalRow, "id" | "paypal_connected_at" | "paypal_mode">,
  status: { paymentsReceivable: boolean; primaryEmailConfirmed: boolean },
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const mode = paypalEnvironment();
  if (firm.paypal_mode === "live" && mode === "sandbox") {
    console.warn(
      "[paypal-connect] skipped: a sandbox status write would overwrite the live connection for firm",
      firm.id,
    );
    return;
  }
  const ready = status.paymentsReceivable && status.primaryEmailConfirmed;
  const updates: Record<string, unknown> = {
    paypal_payments_receivable: status.paymentsReceivable,
    paypal_email_confirmed: status.primaryEmailConfirmed,
    paypal_mode: mode,
  };
  if (ready && !firm.paypal_connected_at) {
    updates.paypal_connected_at = new Date().toISOString();
  }
  const { error } = await sb.from("firms").update(updates).eq("id", firm.id);
  if (error) {
    console.error("[paypal-connect] applyPayPalSellerStatus failed:", error);
    throw error;
  }
}

// The accountant disconnected PayPal from Vylan's side (or consent was revoked
// from PayPal's side — the Phase 4 webhook calls this too). Reset so the UI
// shows "connect" again and no PayPal payment can be attempted.
export async function clearFirmPayPalConnection(firmId: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("firms")
    .update({
      paypal_merchant_id: null,
      paypal_payments_receivable: false,
      paypal_email_confirmed: false,
      paypal_connected_at: null,
      paypal_mode: null,
    })
    .eq("id", firmId);
  if (error) {
    console.error("[paypal-connect] clearFirmPayPalConnection failed:", error);
    throw error;
  }
}

// The firm's PayPal merchant id, or null when not connected. Used by the
// payment reconcile paths, which need only the seller id (the mode gate guards
// OFFERING the rail; healing an existing order is always legitimate).
export async function firmPayPalMerchantId(
  firmId: string,
): Promise<string | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("firms")
    .select("paypal_merchant_id")
    .eq("id", firmId)
    .maybeSingle();
  if (error) {
    console.error("[paypal-connect] firmPayPalMerchantId failed:", error);
    return null;
  }
  return (data?.paypal_merchant_id as string | null) ?? null;
}

// Forge-proof firm lookup for the Phase 4 webhook: resolve a firm by its PayPal
// merchant id (unique-indexed, 0730) — the same trusted-link pattern the
// Stripe Connect webhook uses.
export async function findFirmByPayPalMerchantId(
  merchantId: string,
): Promise<FirmPayPalRow | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("firms")
    .select(COLS)
    .eq("paypal_merchant_id", merchantId)
    .maybeSingle();
  if (error) {
    console.error("[paypal-connect] findFirmByPayPalMerchantId failed:", error);
    return null;
  }
  return (data as FirmPayPalRow) ?? null;
}

// Pull the live seller status straight from PayPal and persist it — so
// "Connected" never depends on a webhook having arrived. Used by the Settings
// page when a connection exists but isn't ready yet, and by the onboarding
// callback. Returns the refreshed flags (or null when the status can't be
// read; the stored state is left as-is).
export async function syncFirmPayPalStatus(
  firmId: string,
  merchantId: string,
): Promise<{ paymentsReceivable: boolean; primaryEmailConfirmed: boolean } | null> {
  const res = await getSellerIntegrationStatus(merchantId);
  if (!res.ok) return null;
  const sb = getServiceRoleSupabase();
  const { data } = await sb
    .from("firms")
    .select("id, paypal_connected_at, paypal_mode")
    .eq("id", firmId)
    .maybeSingle();
  if (!data) return null;
  try {
    await applyPayPalSellerStatus(
      data as Pick<FirmPayPalRow, "id" | "paypal_connected_at" | "paypal_mode">,
      {
        paymentsReceivable: res.status.paymentsReceivable,
        primaryEmailConfirmed: res.status.primaryEmailConfirmed,
      },
    );
  } catch {
    // Best-effort persist; still return the live status to the caller.
  }
  return {
    paymentsReceivable: res.status.paymentsReceivable,
    primaryEmailConfirmed: res.status.primaryEmailConfirmed,
  };
}
