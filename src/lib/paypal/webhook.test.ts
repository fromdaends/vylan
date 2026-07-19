import { beforeEach, describe, expect, it, vi } from "vitest";

const paypalFetch = vi.fn();
const recordInvoicePaid = vi.fn();
const recordInvoiceFailed = vi.fn();
const reconcile = vi.fn();
const clearConnection = vi.fn();
const findFirmByMerchant = vi.fn();
const firmMerchantId = vi.fn();
const setConnection = vi.fn();
const syncStatus = vi.fn();
let prRow: Record<string, unknown> | null = null;
let webhookIdEnv = "WH-123";

vi.mock("./client", () => ({
  paypalFetch: (path: string, opts?: unknown) => paypalFetch(path, opts),
}));
vi.mock("./config", () => ({
  paypalWebhookId: () => (webhookIdEnv === "" ? null : webhookIdEnv),
}));
vi.mock("@/lib/payments/paid-event", () => ({
  recordInvoicePaid: (...a: unknown[]) => recordInvoicePaid(...a),
  recordInvoiceFailed: (...a: unknown[]) => recordInvoiceFailed(...a),
}));
vi.mock("@/lib/payments/paypal-reconcile", () => ({
  reconcilePayPalOrder: (...a: unknown[]) => reconcile(...a),
}));
vi.mock("@/lib/db/paypal-connect", () => ({
  clearFirmPayPalConnection: (...a: unknown[]) => clearConnection(...a),
  findFirmByPayPalMerchantId: (...a: unknown[]) => findFirmByMerchant(...a),
  firmPayPalMerchantId: (...a: unknown[]) => firmMerchantId(...a),
  setFirmPayPalConnection: (...a: unknown[]) => setConnection(...a),
  syncFirmPayPalStatus: (...a: unknown[]) => syncStatus(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: prRow }) }),
      }),
    }),
  }),
}));

import {
  verifyPayPalWebhookSignature,
  handlePayPalWebhookEvent,
} from "./webhook";

const HEADERS = {
  transmissionId: "t-1",
  transmissionTime: "2026-07-19T00:00:00Z",
  transmissionSig: "sig",
  certUrl: "https://api.sandbox.paypal.com/cert",
  authAlgo: "SHA256withRSA",
};

beforeEach(() => {
  vi.clearAllMocks();
  webhookIdEnv = "WH-123";
  prRow = null;
  recordInvoicePaid.mockResolvedValue({ outcome: "newly_paid" });
});

describe("verifyPayPalWebhookSignature", () => {
  it("SUCCESS from PayPal = verified, and the call carries OUR webhook id", async () => {
    paypalFetch.mockResolvedValue({
      status: 200,
      json: { verification_status: "SUCCESS" },
    });
    const res = await verifyPayPalWebhookSignature(HEADERS, {
      event_type: "X",
    });
    expect(res).toBe("verified");
    const [path, opts] = paypalFetch.mock.calls[0] as [
      string,
      { body: { webhook_id: string; auth_algo: string } },
    ];
    expect(path).toBe("/v1/notifications/verify-webhook-signature");
    expect(opts.body.webhook_id).toBe("WH-123");
    expect(opts.body.auth_algo).toBe("SHA256withRSA");
  });

  it("FAILURE = rejected", async () => {
    paypalFetch.mockResolvedValue({
      status: 200,
      json: { verification_status: "FAILURE" },
    });
    expect(await verifyPayPalWebhookSignature(HEADERS, {})).toBe("rejected");
  });

  it("missing transmission headers are rejected without calling PayPal", async () => {
    expect(
      await verifyPayPalWebhookSignature(
        { ...HEADERS, transmissionSig: null },
        {},
      ),
    ).toBe("rejected");
    expect(paypalFetch).not.toHaveBeenCalled();
  });

  it("no webhook id configured = not_configured (the route 503s)", async () => {
    webhookIdEnv = "";
    expect(await verifyPayPalWebhookSignature(HEADERS, {})).toBe(
      "not_configured",
    );
  });
});

describe("handlePayPalWebhookEvent", () => {
  it("PAYMENT.CAPTURE.COMPLETED feeds the unified paid event with the capture + order refs", async () => {
    const outcome = await handlePayPalWebhookEvent({
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP1",
        custom_id: "inv-1",
        supplementary_data: { related_ids: { order_id: "ORDER1" } },
      },
    });
    expect(outcome).toBe("newly_paid");
    expect(recordInvoicePaid).toHaveBeenCalledWith("inv-1", "paypal", {
      paypalCaptureId: "CAP1",
      paypalOrderId: "ORDER1",
    });
  });

  it("REPLAYED capture event no-ops (paid event reports already_settled)", async () => {
    recordInvoicePaid.mockResolvedValue({ outcome: "already_settled" });
    const outcome = await handlePayPalWebhookEvent({
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP1", custom_id: "inv-1" },
    });
    expect(outcome).toBe("already_settled");
  });

  it("PAYMENT.CAPTURE.DENIED records the failure (which never overwrites paid)", async () => {
    const outcome = await handlePayPalWebhookEvent({
      event_type: "PAYMENT.CAPTURE.DENIED",
      resource: { custom_id: "inv-1" },
    });
    expect(outcome).toBe("failed_recorded");
    expect(recordInvoiceFailed).toHaveBeenCalledWith("inv-1", "paypal");
  });

  it("PAYMENT.CAPTURE.PENDING deliberately does nothing", async () => {
    const outcome = await handlePayPalWebhookEvent({
      event_type: "PAYMENT.CAPTURE.PENDING",
      resource: { custom_id: "inv-1" },
    });
    expect(outcome).toBe("pending_noop");
    expect(recordInvoicePaid).not.toHaveBeenCalled();
    expect(recordInvoiceFailed).not.toHaveBeenCalled();
  });

  it("CHECKOUT.ORDER.APPROVED runs the reconcile for the invoice's firm (the dead-popup backstop)", async () => {
    prRow = { id: "inv-1", firm_id: "firm-1" };
    firmMerchantId.mockResolvedValue("SELLER1");
    reconcile.mockResolvedValue("paid");
    const outcome = await handlePayPalWebhookEvent({
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: "ORDER1", purchase_units: [{ custom_id: "inv-1" }] },
    });
    expect(outcome).toBe("approved_reconciled_paid");
    expect(reconcile).toHaveBeenCalledWith("inv-1", "SELLER1");
  });

  it("MERCHANT.ONBOARDING.COMPLETED stores + syncs a connect whose browser never returned", async () => {
    setConnection.mockResolvedValue({ ok: true });
    const outcome = await handlePayPalWebhookEvent({
      event_type: "MERCHANT.ONBOARDING.COMPLETED",
      resource: { merchant_id: "SELLER9", tracking_id: "firm-9" },
    });
    expect(outcome).toBe("onboarding_stored");
    expect(setConnection).toHaveBeenCalledWith("firm-9", "SELLER9");
    expect(syncStatus).toHaveBeenCalledWith("firm-9", "SELLER9");
  });

  it("MERCHANT.PARTNER-CONSENT.REVOKED clears the right firm's connection", async () => {
    findFirmByMerchant.mockResolvedValue({ id: "firm-3" });
    const outcome = await handlePayPalWebhookEvent({
      event_type: "MERCHANT.PARTNER-CONSENT.REVOKED",
      resource: { merchant_id: "SELLER3" },
    });
    expect(outcome).toBe("connection_cleared");
    expect(clearConnection).toHaveBeenCalledWith("firm-3");
  });

  it("consent revoked for an unknown merchant no-ops", async () => {
    findFirmByMerchant.mockResolvedValue(null);
    const outcome = await handlePayPalWebhookEvent({
      event_type: "MERCHANT.PARTNER-CONSENT.REVOKED",
      resource: { merchant_id: "WHO" },
    });
    expect(outcome).toBe("ignored_unknown_merchant");
    expect(clearConnection).not.toHaveBeenCalled();
  });

  it("events without our custom_id are ignored, not errors", async () => {
    expect(
      await handlePayPalWebhookEvent({
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "CAP-foreign" },
      }),
    ).toBe("ignored_no_custom_id");
  });

  it("unknown event types are ignored", async () => {
    expect(
      await handlePayPalWebhookEvent({ event_type: "BILLING.SOMETHING.ELSE" }),
    ).toBe("ignored_event_type");
  });
});
