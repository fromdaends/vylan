import { beforeEach, describe, expect, it, vi } from "vitest";

const markPaid = vi.fn();
const markFailed = vi.fn();
const logActivity = vi.fn();
const syncStage = vi.fn();
const expireStripeCheckout = vi.fn();

vi.mock("@/lib/db/payment-requests", () => ({
  markPaymentRequestPaidSR: (id: string, opts: unknown) => markPaid(id, opts),
  markPaymentRequestFailedSR: (id: string) => markFailed(id),
}));
vi.mock("@/lib/payments/close-other-rail", () => ({
  expireOpenStripeCheckout: (...args: unknown[]) =>
    expireStripeCheckout(...args),
}));
vi.mock("@/lib/db/activity", () => ({
  logServiceRoleActivity: (...args: unknown[]) => logActivity(...args),
}));
vi.mock("@/lib/engagements/stage-sync", () => ({
  syncEngagementStageSR: (id: string) => syncStage(id),
}));

import { recordInvoicePaid, recordInvoiceFailed } from "./paid-event";

const flipped = {
  firmId: "f1",
  engagementId: "e1",
  amountCents: 25_000,
  currency: "cad",
  stripeCheckoutSessionId: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  markPaid.mockResolvedValue(flipped);
  markFailed.mockResolvedValue({ firmId: "f1", engagementId: "e1" });
  expireStripeCheckout.mockResolvedValue(undefined);
});

describe("recordInvoicePaid", () => {
  it("flips, logs client_paid with the same payload the Stripe webhook always wrote, and syncs the stage", async () => {
    const result = await recordInvoicePaid("pr1", "stripe", {
      checkoutSessionId: "cs_1",
      paymentIntentId: "pi_1",
    });

    expect(result).toEqual({ outcome: "newly_paid" });
    expect(markPaid).toHaveBeenCalledWith("pr1", {
      checkoutSessionId: "cs_1",
      paymentIntentId: "pi_1",
      provider: "stripe",
    });
    expect(logActivity).toHaveBeenCalledWith("f1", "e1", "client_paid", {
      amount_cents: 25_000,
      currency: "cad",
      payment_request_id: "pr1",
      provider: "stripe",
    });
    expect(syncStage).toHaveBeenCalledWith("e1");
  });

  it("already settled (replay, or the other rail won): records NOTHING", async () => {
    markPaid.mockResolvedValue(null);

    const result = await recordInvoicePaid("pr1", "paypal", {
      paypalOrderId: "O1",
      paypalCaptureId: "C1",
    });

    expect(result).toEqual({ outcome: "already_settled" });
    expect(logActivity).not.toHaveBeenCalled();
    expect(syncStage).not.toHaveBeenCalled();
  });

  it("passes PayPal refs + provider through to the flip", async () => {
    await recordInvoicePaid("pr2", "paypal", {
      paypalOrderId: "O2",
      paypalCaptureId: "C2",
    });

    expect(markPaid).toHaveBeenCalledWith("pr2", {
      paypalOrderId: "O2",
      paypalCaptureId: "C2",
      provider: "paypal",
    });
    expect(logActivity).toHaveBeenCalledWith(
      "f1",
      "e1",
      "client_paid",
      expect.objectContaining({ provider: "paypal" }),
    );
  });

  it("syncStage:false (the reconcile path) flips + logs but leaves the stage alone", async () => {
    const result = await recordInvoicePaid(
      "pr1",
      "stripe",
      { checkoutSessionId: "cs_1" },
      { syncStage: false },
    );

    expect(result).toEqual({ outcome: "newly_paid" });
    expect(logActivity).toHaveBeenCalled();
    expect(syncStage).not.toHaveBeenCalled();
  });

  it("a payment with no engagement (engagement_id null) logs but never stage-syncs", async () => {
    markPaid.mockResolvedValue({ ...flipped, engagementId: null });

    await recordInvoicePaid("pr1", "stripe", {});

    expect(logActivity).toHaveBeenCalled();
    expect(syncStage).not.toHaveBeenCalled();
  });

  it("cross-rail closeout: PayPal paying expires the invoice's open Stripe checkout", async () => {
    markPaid.mockResolvedValue({ ...flipped, stripeCheckoutSessionId: "cs_9" });

    await recordInvoicePaid("pr1", "paypal", { paypalOrderId: "O1" });

    expect(expireStripeCheckout).toHaveBeenCalledWith("f1", "cs_9");
  });

  it("no closeout when Stripe itself paid, or when no session was recorded", async () => {
    markPaid.mockResolvedValue({ ...flipped, stripeCheckoutSessionId: "cs_9" });
    await recordInvoicePaid("pr1", "stripe", { checkoutSessionId: "cs_9" });
    expect(expireStripeCheckout).not.toHaveBeenCalled();

    markPaid.mockResolvedValue({ ...flipped, stripeCheckoutSessionId: null });
    await recordInvoicePaid("pr2", "paypal", {});
    expect(expireStripeCheckout).not.toHaveBeenCalled();
  });

  it("a closeout failure never fails the payment that just landed", async () => {
    markPaid.mockResolvedValue({ ...flipped, stripeCheckoutSessionId: "cs_9" });
    expireStripeCheckout.mockRejectedValue(new Error("stripe down"));

    const result = await recordInvoicePaid("pr1", "paypal", {});

    expect(result).toEqual({ outcome: "newly_paid" });
    expect(logActivity).toHaveBeenCalled();
    expect(syncStage).toHaveBeenCalled();
  });
});

describe("recordInvoiceFailed", () => {
  it("marks failed, logs payment_failed, syncs the stage", async () => {
    await recordInvoiceFailed("pr1", "stripe");

    expect(markFailed).toHaveBeenCalledWith("pr1");
    expect(logActivity).toHaveBeenCalledWith("f1", "e1", "payment_failed", {
      payment_request_id: "pr1",
      provider: "stripe",
    });
    expect(syncStage).toHaveBeenCalledWith("e1");
  });

  it("never records a failure over a paid invoice (markFailed no-ops)", async () => {
    markFailed.mockResolvedValue(null);

    await recordInvoiceFailed("pr1", "paypal");

    expect(logActivity).not.toHaveBeenCalled();
    expect(syncStage).not.toHaveBeenCalled();
  });
});
