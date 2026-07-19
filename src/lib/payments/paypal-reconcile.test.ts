import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrder = vi.fn();
const captureOrder = vi.fn();
const recordInvoicePaid = vi.fn();
let prRow: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: prRow }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/paypal/orders", () => ({
  getOrder: (input: unknown) => getOrder(input),
  captureOrder: (input: unknown) => captureOrder(input),
}));
vi.mock("@/lib/paypal/config", () => ({
  isPayPalConfigured: () => true,
}));
vi.mock("@/lib/payments/paid-event", () => ({
  recordInvoicePaid: (...args: unknown[]) => recordInvoicePaid(...args),
}));

import { reconcilePayPalOrder } from "./paypal-reconcile";

const REQUESTED = {
  id: "pr1",
  status: "requested",
  paypal_order_id: "ORDER1",
};

beforeEach(() => {
  vi.clearAllMocks();
  prRow = { ...REQUESTED };
  recordInvoicePaid.mockResolvedValue({ outcome: "newly_paid" });
});

describe("reconcilePayPalOrder", () => {
  it("APPROVED (the dead-popup incident): captures server-side and flips paid", async () => {
    getOrder.mockResolvedValue({
      ok: true,
      status: "APPROVED",
      captureId: null,
      captureStatus: null,
      customId: "pr1",
    });
    captureOrder.mockResolvedValue({
      ok: true,
      status: "COMPLETED",
      captureId: "CAP1",
      customId: "pr1",
    });

    const res = await reconcilePayPalOrder("pr1", "SELLER1");
    expect(res).toBe("paid");
    expect(captureOrder).toHaveBeenCalledWith({
      orderId: "ORDER1",
      sellerMerchantId: "SELLER1",
    });
    expect(recordInvoicePaid).toHaveBeenCalledWith(
      "pr1",
      "paypal",
      { paypalOrderId: "ORDER1", paypalCaptureId: "CAP1" },
      { syncStage: undefined },
    );
  });

  it("COMPLETED order (capture record lost / webhook raced): flips paid without capturing again", async () => {
    getOrder.mockResolvedValue({
      ok: true,
      status: "COMPLETED",
      captureId: "CAP9",
      captureStatus: "COMPLETED",
      customId: "pr1",
    });

    const res = await reconcilePayPalOrder("pr1", "SELLER1");
    expect(res).toBe("paid");
    expect(captureOrder).not.toHaveBeenCalled();
    expect(recordInvoicePaid).toHaveBeenCalled();
  });

  it("CREATED order (buyer never approved): leaves the invoice open, records nothing", async () => {
    getOrder.mockResolvedValue({
      ok: true,
      status: "CREATED",
      captureId: null,
      captureStatus: null,
      customId: "pr1",
    });

    const res = await reconcilePayPalOrder("pr1", "SELLER1");
    expect(res).toBe("requested");
    expect(captureOrder).not.toHaveBeenCalled();
    expect(recordInvoicePaid).not.toHaveBeenCalled();
  });

  it("an already-settled invoice short-circuits without calling PayPal", async () => {
    prRow = { ...REQUESTED, status: "paid" };
    const res = await reconcilePayPalOrder("pr1", "SELLER1");
    expect(res).toBe("paid");
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("no recorded order or no seller id: nothing to check", async () => {
    prRow = { ...REQUESTED, paypal_order_id: null };
    expect(await reconcilePayPalOrder("pr1", "SELLER1")).toBe("requested");
    prRow = { ...REQUESTED };
    expect(await reconcilePayPalOrder("pr1", null)).toBe("requested");
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("order/invoice mismatch (foreign order id): refuses to touch the invoice", async () => {
    getOrder.mockResolvedValue({
      ok: true,
      status: "COMPLETED",
      captureId: "CAPX",
      captureStatus: "COMPLETED",
      customId: "some-other-invoice",
    });

    const res = await reconcilePayPalOrder("pr1", "SELLER1");
    expect(res).toBe("requested");
    expect(recordInvoicePaid).not.toHaveBeenCalled();
  });

  it("APPROVED but PayPal says already captured: flips paid (idempotent outcome)", async () => {
    getOrder.mockResolvedValue({
      ok: true,
      status: "APPROVED",
      captureId: null,
      captureStatus: null,
      customId: "pr1",
    });
    captureOrder.mockResolvedValue({
      ok: false,
      reason: "already_captured",
      detail: "ORDER_ALREADY_CAPTURED",
    });

    const res = await reconcilePayPalOrder("pr1", "SELLER1");
    expect(res).toBe("paid");
    expect(recordInvoicePaid).toHaveBeenCalledWith(
      "pr1",
      "paypal",
      { paypalOrderId: "ORDER1" },
      { syncStage: undefined },
    );
  });

  it("APPROVED but the capture is declined: invoice stays open for a retry", async () => {
    getOrder.mockResolvedValue({
      ok: true,
      status: "APPROVED",
      captureId: null,
      captureStatus: null,
      customId: "pr1",
    });
    captureOrder.mockResolvedValue({ ok: false, reason: "declined" });

    const res = await reconcilePayPalOrder("pr1", "SELLER1");
    expect(res).toBe("requested");
    expect(recordInvoicePaid).not.toHaveBeenCalled();
  });
});
