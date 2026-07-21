import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { ClientXeroCard, type ClientXeroStatus } from "./client-xero-card";

afterEach(() => cleanup());

const baseStatus: ClientXeroStatus = {
  configured: true,
  connected: false,
  needsReconnect: false,
  tenantName: null,
  isDemo: false,
  callbackStatus: null,
};

function renderCard(status: Partial<ClientXeroStatus>, isOwner = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ClientXeroCard
        clientId="c1"
        clientName="Acme"
        status={{ ...baseStatus, ...status }}
        isOwner={isOwner}
      />
    </NextIntlClientProvider>,
  );
}

describe("ClientXeroCard", () => {
  it("not connected + owner: offers Connect Xero (connects THIS client)", () => {
    renderCard({ connected: false }, true);
    expect(screen.getByText("Connect Xero")).toBeTruthy();
  });

  it("not connected + staff: renders nothing", () => {
    const { container } = renderCard({ connected: false }, false);
    expect(container.firstChild).toBeNull();
  });

  it("connected: shows the organisation and the Demo badge for a demo org", () => {
    renderCard({ connected: true, tenantName: "Demo Company (CA)", isDemo: true });
    expect(screen.getByText("Connected to Xero")).toBeTruthy();
    expect(screen.getByText(/Demo Company \(CA\)/)).toBeTruthy();
    expect(screen.getByText("Demo")).toBeTruthy();
  });

  it("connected to a real org: no Demo badge", () => {
    renderCard({ connected: true, tenantName: "Acme Books Ltd", isDemo: false });
    expect(screen.queryByText("Demo")).toBeNull();
  });

  it("dead connection: shows the reconnect prompt to the owner", () => {
    renderCard({
      connected: true,
      needsReconnect: true,
      tenantName: "Acme Books Ltd",
    });
    expect(screen.getByText("Xero needs to be reconnected")).toBeTruthy();
    expect(screen.getByText("Reconnect Xero")).toBeTruthy();
  });

  it("org-already-linked callback: explains instead of a generic error", () => {
    renderCard({ connected: false, callbackStatus: "inuse" }, true);
    expect(
      screen.getByText(/already connected to another client/),
    ).toBeTruthy();
  });

  it("connected: staff see the status but no disconnect action", () => {
    renderCard({ connected: true, tenantName: "Acme Books Ltd" }, false);
    expect(screen.getByText("Connected to Xero")).toBeTruthy();
    expect(screen.queryByText("Disconnect")).toBeNull();
  });
});
