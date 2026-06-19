import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { PaymentsConnectSection, type ConnectStatus } from "./payments-section";

afterEach(() => cleanup());

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
});
