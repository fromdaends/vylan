// Which payment rails a firm can actually take money on. ONE pure rule, shared
// by every gate that used to ask "is Stripe connected?" — invoice creation
// (lib/invoices/create.ts), the automated send (lib/invoices/send.ts), and (from
// Phase 3) the client payment page's method choice. Provider-agnostic on
// purpose: the invoice and lock logic never care WHICH rail pays, only that at
// least one exists to pay on.
//
// Stripe ready  = connect_charges_enabled (Stripe's authoritative flag, written
//                 by the Connect webhook — see 0370). Mode mismatches are
//                 enforced downstream at checkout time, exactly as before.
// PayPal ready  = a merchant id from Partner Referrals onboarding AND PayPal's
//                 two authoritative flags: payments_receivable and a confirmed
//                 primary email (PayPal cannot receive money without both).
//                 When the caller knows the environment's PayPal mode, a
//                 connection stamped with the OTHER mode is not ready here —
//                 unlike Stripe there is no charge-time API rejection to lean
//                 on, so the sandbox/live guard (0730) must gate up front.
//
// Every field is optional so the same function works on any firm-shaped row —
// getCurrentFirm()'s full row, a service-role partial select, or a pre-0730 row
// where the paypal_* columns don't exist yet (missing = no PayPal, so the app
// behaves exactly as before the migration).

export type FirmRailFields = {
  connect_charges_enabled?: boolean | null;
  paypal_merchant_id?: string | null;
  paypal_payments_receivable?: boolean | null;
  paypal_email_confirmed?: boolean | null;
  paypal_mode?: "sandbox" | "live" | null;
};

export type FirmPaymentRails = {
  stripe: boolean;
  paypal: boolean;
  // At least one rail can receive money — the provider-agnostic "can this firm
  // be paid at all?" gate.
  any: boolean;
};

export function firmPaymentRails(
  firm: FirmRailFields | null | undefined,
  opts: {
    // The environment's PayPal mode (from the PayPal config, Phase 2). When
    // provided AND the connection's stored mode is known, they must match.
    // Omitted (Phase 1 callers) = no mode gate, mirroring today's Stripe gate.
    paypalEnvMode?: "sandbox" | "live" | null;
  } = {},
): FirmPaymentRails {
  const stripe = firm?.connect_charges_enabled === true;
  let paypal =
    Boolean(firm?.paypal_merchant_id) &&
    firm?.paypal_payments_receivable === true &&
    firm?.paypal_email_confirmed === true;
  if (
    paypal &&
    opts.paypalEnvMode &&
    firm?.paypal_mode &&
    firm.paypal_mode !== opts.paypalEnvMode
  ) {
    paypal = false;
  }
  return { stripe, paypal, any: stripe || paypal };
}
