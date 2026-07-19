import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { PortalPayPalButton } from "./portal-paypal-button";

const CONFIG = {
  merchantId: "SELLER1",
  clientId: "client-1",
  partnerAttributionId: null,
  sdkUrl: "https://www.sandbox.paypal.com/web-sdk/v6/core",
  environment: "sandbox" as const,
};

const createInstance = vi.fn();
const findEligibleMethods = vi.fn();
const createSession = vi.fn();

function installSdk(eligible: boolean) {
  findEligibleMethods.mockResolvedValue({
    isEligible: (m: string) => (m === "paypal" ? eligible : false),
  });
  createSession.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined) });
  createInstance.mockResolvedValue({
    findEligibleMethods,
    createPayPalOneTimePaymentSession: createSession,
  });
  (window as unknown as { paypal: unknown }).paypal = { createInstance };
}

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PortalPayPalButton token="tok_test" config={CONFIG} locale="en" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { paypal?: unknown }).paypal;
});

describe("PortalPayPalButton", () => {
  it("initializes the SDK as a partner (clientId + merchantId), checks CAD eligibility, mounts the button", async () => {
    installSdk(true);
    const { container } = renderButton();

    await waitFor(() => {
      expect(container.querySelector("paypal-button")).toBeTruthy();
    });
    expect(createInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        merchantId: "SELLER1",
        components: ["paypal-payments"],
        locale: "en-CA",
      }),
    );
    expect(findEligibleMethods).toHaveBeenCalledWith({ currencyCode: "CAD" });
  });

  it("renders nothing when PayPal is ineligible for this buyer (card path stands alone)", async () => {
    installSdk(false);
    const { container } = renderButton();

    await waitFor(() => {
      expect(findEligibleMethods).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.querySelector("paypal-button")).toBeNull();
      expect(container.textContent).toBe("");
    });
  });

  it("passes the partner attribution id when configured", async () => {
    installSdk(true);
    render(
      <NextIntlClientProvider locale="fr" messages={en}>
        <PortalPayPalButton
          token="tok_test"
          config={{ ...CONFIG, partnerAttributionId: "VYLAN_BN" }}
          locale="fr"
        />
      </NextIntlClientProvider>,
    );
    await waitFor(() => {
      expect(createInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerAttributionId: "VYLAN_BN",
          locale: "fr-CA",
        }),
      );
    });
  });
});
