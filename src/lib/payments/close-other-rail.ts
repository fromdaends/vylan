// Cross-rail closeout (Phase 4): the moment ONE rail settles an invoice, kill
// the other rail's still-open checkout so a client with both open can't pay
// twice.
//
// Only one direction needs work: when PAYPAL pays, an already-created Stripe
// Checkout session is still live on Stripe's side and would happily accept a
// card — so we expire it. The reverse needs nothing: an uncaptured PayPal
// order is inert (our capture route re-checks the invoice before capturing,
// and the abandoned order simply expires).
//
// Best-effort by design: an expire failure (already expired, already
// completed, Stripe blip) must never fail the payment that just landed —
// layers 1-3 of the guard (create/capture status checks + the atomic paid
// flip) still make the second charge unrecordable; this layer just closes the
// door earlier.

import { stripe } from "@/lib/stripe";
import { getServiceRoleSupabase } from "@/lib/supabase/server";

export async function expireOpenStripeCheckout(
  firmId: string,
  checkoutSessionId: string,
): Promise<void> {
  const s = stripe();
  if (!s) return;
  const sb = getServiceRoleSupabase();
  const { data: firm } = await sb
    .from("firms")
    .select("stripe_connect_account_id")
    .eq("id", firmId)
    .maybeSingle();
  const accountId =
    (firm?.stripe_connect_account_id as string | null) ?? null;
  if (!accountId) return;
  try {
    // The session lives on the connected account (direct charge). Expiring is
    // only valid while the session is open; any other state throws and is
    // swallowed — that just means there was nothing left to close.
    await s.checkout.sessions.expire(checkoutSessionId, undefined, {
      stripeAccount: accountId,
    });
    console.log(
      "[close-other-rail] expired open Stripe checkout",
      checkoutSessionId,
    );
  } catch {
    // Already expired / completed / cross-mode: nothing to do.
  }
}
