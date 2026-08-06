// Reading the deposit's real state from the database.
//
// The RULE lives in activation.ts and is pure. This is the I/O that feeds it,
// kept separate for the same reason stage.ts and stage-sync.ts are separate:
// the decision stays provable in a unit test, and every caller asking "is this
// engagement waiting on its deposit?" gets the same answer from the same read.
//
// Three callers, three worlds — the client's own accept (token only), the
// firm's accept-on-behalf (an accountant's session), and the portal render.
// All service-role, because the client path has no session at all.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { firmPaymentRails } from "@/lib/payments/rails";
import {
  acceptanceActivatesImmediately,
  type ActivationFacts,
} from "@/lib/engagements/activation";

export type DepositState = ActivationFacts & {
  /** The deposit invoice, once one has been raised. */
  paymentRequestId: string | null;
  acceptedAt: string | null;
};

/**
 * Everything the activation rule needs, read fresh.
 *
 * TOTAL — never throws. It runs inside the client's accept, and an accepted
 * agreement must not become an error on their screen because a rails lookup
 * hiccupped. Every failure degrades toward "no deposit gate", which activates
 * the engagement: the safe direction, because the alternative traps a client in
 * a portal that will not open.
 */
export async function readDepositState(
  engagementId: string,
): Promise<DepositState> {
  const safe: DepositState = {
    depositCents: null,
    canCollectPayment: false,
    depositPaid: false,
    paymentRequestId: null,
    acceptedAt: null,
  };

  try {
    const sb = getServiceRoleSupabase();

    const { data: engRow } = await sb
      .from("engagements")
      .select("id, firm_id, accepted_at, deposit_cents")
      .eq("id", engagementId)
      .maybeSingle();
    const eng = engRow as {
      firm_id: string;
      accepted_at: string | null;
      deposit_cents: number | null;
    } | null;
    if (!eng) return safe;

    const depositCents =
      typeof eng.deposit_cents === "number" && eng.deposit_cents > 0
        ? eng.deposit_cents
        : null;
    const acceptedAt = eng.accepted_at ?? null;

    // No deposit means nothing else matters — skip both remaining reads, which
    // is the overwhelmingly common path (most engagements ask for nothing up
    // front) and this runs on every portal render.
    if (depositCents == null) {
      return { ...safe, acceptedAt, canCollectPayment: false };
    }

    const [rails, deposit] = await Promise.all([
      readRails(sb, eng.firm_id),
      readDepositInvoice(sb, engagementId),
    ]);

    return {
      depositCents,
      canCollectPayment: rails,
      depositPaid: deposit.paid,
      paymentRequestId: deposit.id,
      acceptedAt,
    };
  } catch (e) {
    console.error("[deposit-state] read failed:", e);
    return safe;
  }
}

/** Convenience for the two accept paths: does agreeing start the work? */
export async function acceptanceStartsWorkNow(
  engagementId: string,
): Promise<boolean> {
  return acceptanceActivatesImmediately(await readDepositState(engagementId));
}

type Sb = ReturnType<typeof getServiceRoleSupabase>;

async function readRails(sb: Sb, firmId: string): Promise<boolean> {
  // Both rails' readiness, with the same pre-0730 fallback sendEngagementInvoice
  // uses so a deploy ahead of its migration reads Stripe only rather than
  // erroring — which here would read as "cannot collect" and wrongly open the
  // portal for free.
  const railCols =
    "connect_charges_enabled, paypal_merchant_id, paypal_payments_receivable, paypal_email_confirmed";
  const first = await sb
    .from("firms")
    .select(railCols)
    .eq("id", firmId)
    .maybeSingle();
  let row: unknown = first.data;
  if (first.error) {
    const legacy = await sb
      .from("firms")
      .select("connect_charges_enabled")
      .eq("id", firmId)
      .maybeSingle();
    if (legacy.error) return false;
    row = legacy.data;
  }
  if (!row) return false;
  return firmPaymentRails(
    row as Parameters<typeof firmPaymentRails>[0],
  ).any;
}

async function readDepositInvoice(
  sb: Sb,
  engagementId: string,
): Promise<{ id: string | null; paid: boolean }> {
  const { data, error } = await sb
    .from("payment_requests")
    .select("id, status")
    .eq("engagement_id", engagementId)
    .eq("kind", "deposit")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Pre-1680 there is no `kind` column, so no deposit can exist and none can
  // have been paid. Reporting "unpaid" there would gate a portal on an invoice
  // that cannot be raised, so the caller's rails check is what saves it — but
  // be explicit rather than relying on that.
  if (error || !data) return { id: null, paid: false };
  const row = data as { id: string; status: string };
  return { id: row.id, paid: row.status === "paid" };
}
