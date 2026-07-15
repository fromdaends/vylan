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
import { PaymentsConnectSection, type ConnectStatus } from "./payments-section";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE: ConnectStatus = {
  configured: true,
  accountId: null,
  chargesEnabled: false,
  detailsSubmitted: false,
  onboardedAt: null,
  justReturned: false,
};

function renderConnect(overrides: Partial<ConnectStatus> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PaymentsConnectSection connect={{ ...BASE, ...overrides }} />
    </NextIntlClientProvider>,
  );
}

describe("PaymentsConnectSection", () => {
  it("not connected: shows the Connect Stripe call to action", () => {
    renderConnect();
    expect(
      screen.getByText(en.Settings.connect_start_title),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.connect_cta }),
    ).toBeInTheDocument();
  });

  it("incomplete (account started, charges not enabled): shows Finish connecting", () => {
    renderConnect({ accountId: "acct_test_123" });
    expect(
      screen.getByText(en.Settings.connect_incomplete_title),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.connect_resume_cta }),
    ).toBeInTheDocument();
  });

  it("connected: shows the ready state + Manage on Stripe link, no connect button", () => {
    renderConnect({ accountId: "acct_test_123", chargesEnabled: true });
    expect(
      screen.getByText(en.Settings.connect_connected_title),
    ).toBeInTheDocument();
    const manage = screen.getByRole("link", { name: en.Settings.connect_manage });
    expect(manage).toHaveAttribute("href", "https://dashboard.stripe.com");
    expect(
      screen.queryByRole("button", { name: en.Settings.connect_cta }),
    ).not.toBeInTheDocument();
  });

  it("shows a confirming note only right after returning from Stripe while incomplete", () => {
    renderConnect({ accountId: "acct_test_123", justReturned: true });
    expect(
      screen.getByText(en.Settings.connect_confirming),
    ).toBeInTheDocument();
  });

  it("platform not configured: shows the unavailable note, no connect button", () => {
    renderConnect({ configured: false });
    expect(
      screen.getByText(en.Settings.connect_unavailable),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.Settings.connect_cta }),
    ).not.toBeInTheDocument();
  });

  it("no Disconnect option when there is no connected account", () => {
    renderConnect();
    expect(
      screen.queryByRole("button", { name: en.Settings.connect_disconnect }),
    ).not.toBeInTheDocument();
  });

  it("connected: offers Disconnect, and confirming POSTs to the disconnect route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    // jsdom throws on window.location.reload — stub it so the handler can call it.
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      writable: true,
    });

    renderConnect({ accountId: "acct_test_123", chargesEnabled: true });

    // First click asks for confirmation (guards against an accidental disconnect).
    fireEvent.click(
      screen.getByRole("button", { name: en.Settings.connect_disconnect }),
    );
    expect(
      screen.getByText(en.Settings.connect_disconnect_confirm),
    ).toBeInTheDocument();

    // Confirming hits the endpoint and reloads.
    fireEvent.click(
      screen.getByRole("button", { name: en.Settings.connect_disconnect_yes }),
    );
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/billing/connect/disconnect", {
        method: "POST",
      });
    });
  });

  it("incomplete connection can also be disconnected", () => {
    renderConnect({ accountId: "acct_test_123" });
    expect(
      screen.getByRole("button", { name: en.Settings.connect_disconnect }),
    ).toBeInTheDocument();
  });
});
