import { describe, it, expect, vi, beforeEach } from "vitest";

// Same tiny chainable DB stub as stripe-connect.test.ts: select result and
// update outcome set per-test, update payload spied on. PayPal env mode is
// controlled per-test.
let mode: "sandbox" | "live" = "sandbox";
let selectResult: { data: unknown; error: unknown } = { data: null, error: null };
let updateResult: { error: unknown } = { error: null };
const updateSpy = vi.fn();

function chain() {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.update = vi.fn((payload: unknown) => {
    updateSpy(payload);
    return c;
  });
  c.eq = vi.fn(() => c);
  c.maybeSingle = vi.fn(() => Promise.resolve(selectResult));
  c.then = (resolve: (v: unknown) => void) => resolve(updateResult);
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({ from: vi.fn(() => chain()) }),
}));
vi.mock("@/lib/paypal/config", () => ({
  paypalEnvironment: () => mode,
}));
vi.mock("@/lib/paypal/onboarding", () => ({
  getSellerIntegrationStatus: vi.fn(),
}));

import {
  setFirmPayPalConnection,
  applyPayPalSellerStatus,
} from "./paypal-connect";

beforeEach(() => {
  vi.clearAllMocks();
  mode = "sandbox";
  selectResult = { data: null, error: null };
  updateResult = { error: null };
});

describe("setFirmPayPalConnection — mode stamping + anti-clobber", () => {
  it("refuses a SANDBOX connect that would clobber a LIVE connection", async () => {
    mode = "sandbox";
    selectResult = {
      data: { paypal_merchant_id: "LIVE1", paypal_mode: "live" },
      error: null,
    };
    const res = await setFirmPayPalConnection("firm1", "SANDBOX1");
    expect(res).toEqual({ ok: false, reason: "would_clobber_live" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("stamps the mode and writes on a fresh connect", async () => {
    selectResult = { data: null, error: null };
    const res = await setFirmPayPalConnection("firm1", "SELLER1");
    expect(res).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalledWith({
      paypal_merchant_id: "SELLER1",
      paypal_mode: "sandbox",
    });
  });

  it("a live connect may replace a sandbox connection", async () => {
    mode = "live";
    selectResult = {
      data: { paypal_merchant_id: "SB1", paypal_mode: "sandbox" },
      error: null,
    };
    const res = await setFirmPayPalConnection("firm1", "LIVE9");
    expect(res).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalledWith({
      paypal_merchant_id: "LIVE9",
      paypal_mode: "live",
    });
  });

  it("unique-index rejection (same PayPal account on another firm) = already_linked", async () => {
    selectResult = { data: null, error: null };
    updateResult = { error: { code: "23505" } };
    const res = await setFirmPayPalConnection("firm1", "TAKEN");
    expect(res).toEqual({ ok: false, reason: "already_linked" });
  });
});

describe("applyPayPalSellerStatus", () => {
  it("stamps paypal_connected_at only when the rail first becomes ready", async () => {
    await applyPayPalSellerStatus(
      { id: "firm1", paypal_connected_at: null, paypal_mode: "sandbox" },
      { paymentsReceivable: true, primaryEmailConfirmed: true },
    );
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.paypal_payments_receivable).toBe(true);
    expect(payload.paypal_email_confirmed).toBe(true);
    expect(typeof payload.paypal_connected_at).toBe("string");
  });

  it("does not restamp connected_at, and not-ready never stamps it", async () => {
    await applyPayPalSellerStatus(
      {
        id: "firm1",
        paypal_connected_at: "2026-01-01T00:00:00Z",
        paypal_mode: "sandbox",
      },
      { paymentsReceivable: true, primaryEmailConfirmed: true },
    );
    expect(
      (updateSpy.mock.calls[0][0] as Record<string, unknown>)
        .paypal_connected_at,
    ).toBeUndefined();

    updateSpy.mockClear();
    await applyPayPalSellerStatus(
      { id: "firm1", paypal_connected_at: null, paypal_mode: "sandbox" },
      { paymentsReceivable: true, primaryEmailConfirmed: false },
    );
    expect(
      (updateSpy.mock.calls[0][0] as Record<string, unknown>)
        .paypal_connected_at,
    ).toBeUndefined();
  });

  it("a SANDBOX status write never touches a LIVE connection", async () => {
    mode = "sandbox";
    await applyPayPalSellerStatus(
      { id: "firm1", paypal_connected_at: null, paypal_mode: "live" },
      { paymentsReceivable: false, primaryEmailConfirmed: false },
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
