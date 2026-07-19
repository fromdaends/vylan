import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import {
  ClientQuickbooksCard,
  type ClientQuickbooksStatus,
} from "./client-quickbooks-card";

afterEach(() => cleanup());

const baseStatus: ClientQuickbooksStatus = {
  configured: true,
  connected: false,
  needsReconnect: false,
  companyName: null,
  environment: "sandbox",
  callbackStatus: null,
};

function renderCard(
  status: Partial<ClientQuickbooksStatus>,
  isOwner = true,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ClientQuickbooksCard
        clientId="c1"
        clientName="Acme"
        status={{ ...baseStatus, ...status }}
        isOwner={isOwner}
      />
    </NextIntlClientProvider>,
  );
}

describe("ClientQuickbooksCard", () => {
  it("owner + not connected: names the client and offers Connect", () => {
    renderCard({ connected: false });
    // The client's name in the title is what teaches this is per-client.
    expect(screen.getByText("Connect Acme's QuickBooks")).toBeTruthy();
    expect(screen.getByText("Connect QuickBooks")).toBeTruthy();
  });

  it("staff + not connected: calm note, no Connect button", () => {
    renderCard({ connected: false }, false);
    expect(
      screen.getByText("Ask an owner to connect this client's QuickBooks."),
    ).toBeTruthy();
    expect(screen.queryByText("Connect QuickBooks")).toBeNull();
  });

  it("connected: shows the linked company name and the sandbox badge", () => {
    renderCard({ connected: true, companyName: "Acme Books Inc." });
    expect(screen.getByText("Connected to QuickBooks")).toBeTruthy();
    expect(screen.getByText(/Acme Books Inc\./)).toBeTruthy();
    expect(screen.getByText("Sandbox")).toBeTruthy();
  });

  it("dead connection: shows the reconnect prompt to the owner", () => {
    renderCard({
      connected: true,
      needsReconnect: true,
      companyName: "Acme Books Inc.",
    });
    expect(screen.getByText("QuickBooks needs to be reconnected")).toBeTruthy();
    expect(screen.getByText("Reconnect QuickBooks")).toBeTruthy();
  });

  it("not configured: a calm unavailable note, no action", () => {
    renderCard({ configured: false });
    expect(
      screen.getByText("QuickBooks isn't set up yet. Check back soon."),
    ).toBeTruthy();
    expect(screen.queryByText("Connect QuickBooks")).toBeNull();
  });
});
