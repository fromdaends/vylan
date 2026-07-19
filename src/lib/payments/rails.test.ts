import { describe, expect, it } from "vitest";
import { firmPaymentRails } from "./rails";

const paypalReady = {
  paypal_merchant_id: "M123",
  paypal_payments_receivable: true,
  paypal_email_confirmed: true,
};

describe("firmPaymentRails", () => {
  it("no firm / empty firm = no rails (today's zero-connection behavior)", () => {
    expect(firmPaymentRails(null)).toEqual({
      stripe: false,
      paypal: false,
      any: false,
    });
    expect(firmPaymentRails({})).toEqual({
      stripe: false,
      paypal: false,
      any: false,
    });
  });

  it("Stripe ready = connect_charges_enabled, exactly the pre-PayPal gate", () => {
    expect(firmPaymentRails({ connect_charges_enabled: true })).toEqual({
      stripe: true,
      paypal: false,
      any: true,
    });
    // A half-onboarded Stripe (account exists, charges not enabled) is NOT
    // ready — same as before.
    expect(firmPaymentRails({ connect_charges_enabled: false }).any).toBe(false);
  });

  it("PayPal ready needs merchant id + receivable + confirmed email, all three", () => {
    expect(firmPaymentRails(paypalReady)).toEqual({
      stripe: false,
      paypal: true,
      any: true,
    });
    expect(
      firmPaymentRails({ ...paypalReady, paypal_payments_receivable: false })
        .paypal,
    ).toBe(false);
    expect(
      firmPaymentRails({ ...paypalReady, paypal_email_confirmed: false }).paypal,
    ).toBe(false);
    expect(
      firmPaymentRails({ ...paypalReady, paypal_merchant_id: null }).paypal,
    ).toBe(false);
  });

  it("a pre-0730 row (paypal columns absent) reads as Stripe-only", () => {
    expect(firmPaymentRails({ connect_charges_enabled: true })).toEqual({
      stripe: true,
      paypal: false,
      any: true,
    });
  });

  it("both rails connected", () => {
    expect(
      firmPaymentRails({ connect_charges_enabled: true, ...paypalReady }),
    ).toEqual({ stripe: true, paypal: true, any: true });
  });

  it("PayPal mode gate: a sandbox connection is not ready in a live environment (and vice versa)", () => {
    const sandboxConn = { ...paypalReady, paypal_mode: "sandbox" as const };
    expect(
      firmPaymentRails(sandboxConn, { paypalEnvMode: "live" }).paypal,
    ).toBe(false);
    expect(
      firmPaymentRails(sandboxConn, { paypalEnvMode: "sandbox" }).paypal,
    ).toBe(true);
    // Unknown stored mode (legacy row) or no env mode supplied = no gate.
    expect(
      firmPaymentRails(paypalReady, { paypalEnvMode: "live" }).paypal,
    ).toBe(true);
    expect(firmPaymentRails(sandboxConn).paypal).toBe(true);
  });

  it("the mode gate never affects Stripe", () => {
    expect(
      firmPaymentRails(
        { connect_charges_enabled: true, ...paypalReady, paypal_mode: "sandbox" },
        { paypalEnvMode: "live" },
      ),
    ).toEqual({ stripe: true, paypal: false, any: true });
  });
});
