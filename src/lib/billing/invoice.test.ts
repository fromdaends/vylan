import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  isSubscriptionInvoice,
  planForInvoice,
  invoiceLinePeriodEnd,
} from "./invoice";

// Minimal invoice shape — only the fields the helpers read.
function inv(partial: Record<string, unknown>): Stripe.Invoice {
  return {
    lines: { data: [] },
    metadata: {},
    ...partial,
  } as unknown as Stripe.Invoice;
}

describe("isSubscriptionInvoice", () => {
  it("is true when the invoice has a subscription (legacy field)", () => {
    expect(isSubscriptionInvoice(inv({ subscription: "sub_123" }))).toBe(true);
  });
  it("is true via parent.subscription_details (newer API)", () => {
    expect(
      isSubscriptionInvoice(
        inv({ parent: { subscription_details: { subscription: "sub_1" } } }),
      ),
    ).toBe(true);
  });
  it("is true when a line item belongs to a subscription", () => {
    expect(
      isSubscriptionInvoice(inv({ lines: { data: [{ subscription: "sub_1" }] } })),
    ).toBe(true);
  });
  it("is false for a standalone one-off invoice", () => {
    expect(
      isSubscriptionInvoice(
        inv({ lines: { data: [{ description: "Vylan — annual" }] } }),
      ),
    ).toBe(false);
  });
});

describe("planForInvoice", () => {
  it("defaults a custom one-off invoice to full access (cabinet_plus)", () => {
    expect(planForInvoice(inv({}))).toBe("cabinet_plus");
  });
  it("honours an explicit, allowed metadata.plan", () => {
    expect(planForInvoice(inv({ metadata: { plan: "cabinet" } }))).toBe(
      "cabinet",
    );
    expect(planForInvoice(inv({ metadata: { plan: "solo" } }))).toBe("solo");
  });
  it("ignores an invalid metadata.plan and falls back to full access", () => {
    expect(planForInvoice(inv({ metadata: { plan: "trial" } }))).toBe(
      "cabinet_plus",
    );
    expect(planForInvoice(inv({ metadata: { plan: "garbage" } }))).toBe(
      "cabinet_plus",
    );
  });
});

describe("invoiceLinePeriodEnd", () => {
  it("returns the first line's period end when present", () => {
    expect(
      invoiceLinePeriodEnd(
        inv({ lines: { data: [{ period: { end: 1700000000 } }] } }),
      ),
    ).toBe(1700000000);
  });
  it("returns null when absent", () => {
    expect(invoiceLinePeriodEnd(inv({}))).toBeNull();
  });
});
