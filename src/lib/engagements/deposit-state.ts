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
  /** The invoice the client should pay first, once one has been raised. */
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
    dueNowCents: null,
    canCollectPayment: false,
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

    const acceptedAt = eng.accepted_at ?? null;

    // ── WHAT IS ACTUALLY OUTSTANDING ──────────────────────────────────────
    //
    // Not "is there a deposit column" — what does the client still OWE right
    // now. That is the sum of every live, unpaid invoice on the engagement:
    // the deposit AND an on-acceptance engagement invoice both qualify, and
    // reading only the deposit column let a $459.90 on-acceptance engagement
    // through the gate untouched.
    //
    // Nothing accepted yet means nothing has been raised yet, so skip the
    // remaining reads — this runs on every portal render.
    if (acceptedAt == null) {
      return { ...safe, acceptedAt: null };
    }

    const [rails, outstanding] = await Promise.all([
      readRails(sb, eng.firm_id),
      readOutstanding(sb, engagementId),
    ]);

    return {
      dueNowCents: outstanding.cents > 0 ? outstanding.cents : null,
      canCollectPayment: rails,
      paymentRequestId: outstanding.firstId,
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

/**
 * Every live invoice on this engagement that is still owed.
 *
 * `status = 'requested'` is the open state; paid, failed and cancelled are all
 * excluded — a failed attempt is retried against the same row, and a cancelled
 * invoice is a decision the firm made, not a debt.
 *
 * Ordered oldest-first so `firstId` matches what the portal's checkout will
 * actually charge (getOldestOpenPaymentRequestForEngagementSR), rather than
 * naming one invoice on screen and charging another.
 */
async function readOutstanding(
  sb: Sb,
  engagementId: string,
): Promise<{ cents: number; firstId: string | null }> {
  const { data, error } = await sb
    .from("payment_requests")
    .select("id, amount_cents, status")
    .eq("engagement_id", engagementId)
    .eq("status", "requested")
    .order("created_at", { ascending: true });
  if (error || !data) return { cents: 0, firstId: null };
  const rows = data as Array<{ id: string; amount_cents: number | null }>;
  return {
    cents: rows.reduce(
      (sum, r) => sum + (typeof r.amount_cents === "number" ? r.amount_cents : 0),
      0,
    ),
    firstId: rows[0]?.id ?? null,
  };
}
