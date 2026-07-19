import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import {
  PayPalConnectSection,
  type PayPalStatus,
} from "./payments-paypal-section";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE: PayPalStatus = {
  configured: true,
  merchantId: null,
  paymentsReceivable: false,
  emailConfirmed: false,
  environment: "sandbox",
  callbackStatus: null,
};

function renderPayPal(overrides: Partial<PayPalStatus> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PayPalConnectSection paypal={{ ...BASE, ...overrides }} />
    </NextIntlClientProvider>,
  );
}

describe("PayPalConnectSection", () => {
  it("platform not configured: renders NOTHING (an absent second rail has no card)", () => {
    const { container } = renderPayPal({ configured: false });
    expect(container.innerHTML).toBe("");
  });

  it("not connected: shows the Connect PayPal call to action", () => {
    renderPayPal();
    expect(screen.getByText(en.Settings.paypal_start_title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.paypal_cta }),
    ).toBeInTheDocument();
  });

  it("incomplete (linked, can't receive yet): shows Finish PayPal setup", () => {
    renderPayPal({ merchantId: "M123" });
    expect(
      screen.getByText(en.Settings.paypal_incomplete_title),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.paypal_resume_cta }),
    ).toBeInTheDocument();
  });

  it("receivable but email unconfirmed still counts as incomplete", () => {
    renderPayPal({ merchantId: "M123", paymentsReceivable: true });
    expect(
      screen.getByText(en.Settings.paypal_incomplete_title),
    ).toBeInTheDocument();
  });

  it("connected: ready state + manage link + holds note, no connect button", () => {
    renderPayPal({
      merchantId: "M123",
      paymentsReceivable: true,
      emailConfirmed: true,
    });
    expect(
      screen.getByText(en.Settings.paypal_connected_title),
    ).toBeInTheDocument();
    expect(screen.getByText(en.Settings.paypal_holds_note)).toBeInTheDocument();
    const manage = screen.getByRole("link", {
      name: en.Settings.paypal_manage,
    });
    expect(manage).toHaveAttribute("href", "https://www.sandbox.paypal.com");
    expect(
      screen.queryByRole("button", { name: en.Settings.paypal_cta }),
    ).not.toBeInTheDocument();
  });

  it("sandbox badge shows in sandbox and not in live", () => {
    renderPayPal({ merchantId: "M123" });
    expect(
      screen.getByText(en.Settings.paypal_sandbox_badge),
    ).toBeInTheDocument();
    cleanup();
    renderPayPal({ merchantId: "M123", environment: "live" });
    expect(
      screen.queryByText(en.Settings.paypal_sandbox_badge),
    ).not.toBeInTheDocument();
  });

  it("live environment points the manage link at the real PayPal", () => {
    renderPayPal({
      merchantId: "M123",
      paymentsReceivable: true,
      emailConfirmed: true,
      environment: "live",
    });
    expect(
      screen.getByRole("link", { name: en.Settings.paypal_manage }),
    ).toHaveAttribute("href", "https://www.paypal.com");
  });

  it("callback statuses render their messages", () => {
    renderPayPal({ callbackStatus: "partnerid" });
    expect(
      screen.getByText(en.Settings.paypal_error_partnerid),
    ).toBeInTheDocument();
    cleanup();
    renderPayPal({ callbackStatus: "linked" });
    expect(
      screen.getByText(en.Settings.paypal_error_linked),
    ).toBeInTheDocument();
    cleanup();
    // pending right after returning: the confirming note, not an error.
    renderPayPal({ merchantId: "M123", callbackStatus: "pending" });
    expect(screen.getByText(en.Settings.paypal_confirming)).toBeInTheDocument();
  });

  it("no Disconnect option when nothing is linked", () => {
    renderPayPal();
    expect(
      screen.queryByRole("button", { name: en.Settings.paypal_disconnect }),
    ).not.toBeInTheDocument();
  });

  it("connected: Disconnect asks to confirm, then POSTs to the disconnect route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      writable: true,
    });

    renderPayPal({
      merchantId: "M123",
      paymentsReceivable: true,
      emailConfirmed: true,
    });
    fireEvent.click(
      screen.getByRole("button", { name: en.Settings.paypal_disconnect }),
    );
    expect(
      screen.getByText(en.Settings.paypal_disconnect_confirm),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: en.Settings.paypal_disconnect_yes }),
    );
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/billing/paypal/disconnect", {
        method: "POST",
      });
    });
  });

  it("Connect PayPal POSTs to the onboard route and redirects to the action url", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://www.sandbox.paypal.com/onboard" }),
    } as Response);
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign },
      writable: true,
    });

    renderPayPal();
    fireEvent.click(screen.getByRole("button", { name: en.Settings.paypal_cta }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/billing/paypal/onboard", {
        method: "POST",
      });
      expect(assign).toHaveBeenCalledWith(
        "https://www.sandbox.paypal.com/onboard",
      );
    });
  });

  it("partner-not-authorized shows the pending-approval message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "not_authorized" }),
    } as Response);
    renderPayPal();
    fireEvent.click(screen.getByRole("button", { name: en.Settings.paypal_cta }));
    await waitFor(() => {
      expect(
        screen.getByText(en.Settings.paypal_error_partner_pending),
      ).toBeInTheDocument();
    });
  });
});
