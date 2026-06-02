import type Stripe from "stripe";
import { planForPriceId, type PlanId } from "@/lib/plans";

// Plan tiers we accept from metadata as a fallback when a price ID isn't one of
// our published plans — i.e. a custom-priced subscription or invoice created in
// the Stripe Dashboard for a private deal. 'trial' is excluded: paying can
// never drop someone to trial, and cancellations route through their own
// handler. These are only ever authored by the Stripe account owner, so they're
// safe to trust (no public flow can create a custom price).
export const ALLOWED_FALLBACK_PLANS: ReadonlySet<PlanId> = new Set([
  "solo",
  "cabinet",
  "cabinet_plus",
]);

// True when an invoice belongs to a subscription (recurring billing). Those are
// activated by the customer.subscription.* webhook handlers, so the invoice.paid
// handler must skip them — otherwise a subscription's first invoice would be
// processed twice and could fight over the plan tier. The "is it a subscription"
// signal moved across Stripe API versions, so we check every known location.
export function isSubscriptionInvoice(invoice: Stripe.Invoice): boolean {
  const inv = invoice as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
    parent?: { subscription_details?: unknown } | null;
  };
  if (inv.subscription) return true;
  if (inv.parent?.subscription_details) return true;
  const lines = invoice.lines?.data ?? [];
  return lines.some((l) => {
    const line = l as {
      subscription?: string | null;
      parent?: { subscription_item_details?: unknown } | null;
    };
    return (
      line.subscription != null ||
      line.parent?.subscription_item_details != null
    );
  });
}

// The plan a paid one-off invoice grants. A recognised published price maps to
// its plan; otherwise (a custom price the founder authored for a private deal)
// honour an explicit metadata.plan, else default to full access. A paid invoice
// always grants *some* access, so this never returns null.
export function planForInvoice(invoice: Stripe.Invoice): PlanId {
  const line = invoice.lines?.data?.[0] as
    | {
        price?: { id?: string } | null;
        pricing?: { price_details?: { price?: string } } | null;
      }
    | undefined;
  const priceId =
    (typeof line?.price?.id === "string" ? line.price.id : null) ??
    (typeof line?.pricing?.price_details?.price === "string"
      ? line.pricing.price_details.price
      : null);
  const known = priceId ? planForPriceId(priceId) : null;
  if (known) return known;

  const metaPlan = invoice.metadata?.plan;
  if (
    typeof metaPlan === "string" &&
    ALLOWED_FALLBACK_PLANS.has(metaPlan as PlanId)
  ) {
    return metaPlan as PlanId;
  }
  return "cabinet_plus";
}

// The "paid through" date from the first line item's billing period, in Unix
// seconds, if the invoice carries one. Null when absent (typical for a bare
// one-off invoice with no explicit period).
export function invoiceLinePeriodEnd(invoice: Stripe.Invoice): number | null {
  const end = invoice.lines?.data?.[0]?.period?.end;
  return typeof end === "number" ? end : null;
}
