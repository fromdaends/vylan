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
import { PaymentDueCard } from "./payment-due-card";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type PR = React.ComponentProps<typeof PaymentDueCard>["paymentRequest"];
const BASE: PR = {
  id: "pr1",
  amount_cents: 35000,
  currency: "cad",
  description: null,
  status: "requested",
};

function renderCard(
  overrides: Partial<PR> = {},
  justReturnedPaid = false,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PaymentDueCard
        token="tok_test"
        paymentRequest={{ ...BASE, ...overrides }}
        firmName="Acme"
        locale="en"
        justReturnedPaid={justReturnedPaid}
      />
    </NextIntlClientProvider>,
  );
}

describe("PaymentDueCard", () => {
  it("shows Pay now + the amount when a payment is due", () => {
    renderCard();
    expect(screen.getByText(en.Portal.pay_due_title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(en.Portal.pay_now) }),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$350\.00/)).toBeInTheDocument();
  });

  it("shows the thank-you state once paid (no Pay now button)", () => {
    renderCard({ status: "paid" });
    expect(screen.getByText(en.Portal.pay_received_title)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(en.Portal.pay_now) }),
    ).not.toBeInTheDocument();
  });

  it("shows the thank-you state right after returning from checkout", () => {
    renderCard({ status: "requested" }, true);
    expect(screen.getByText(en.Portal.pay_received_title)).toBeInTheDocument();
  });

  it("shows the retry state on a failed payment", () => {
    renderCard({ status: "failed" });
    expect(screen.getByText(en.Portal.pay_failed_title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(en.Portal.pay_try_again) }),
    ).toBeInTheDocument();
  });

  it("shows the attached invoice document in the portal", () => {
    renderCard({
      attachment_id: "fd-invoice",
      attachment_filename: "Invoice-2026.pdf",
    });
    const link = screen.getByRole("link", { name: /Invoice-2026\.pdf/ });
    expect(link).toHaveAttribute(
      "href",
      "/api/portal/invoices/fd-invoice?token=tok_test&download=1",
    );
  });

  it("renders nothing for a canceled request", () => {
    const { container } = renderCard({ status: "canceled" });
    expect(container).toBeEmptyDOMElement();
  });

  // The checkout route returns a distinct reason code per failure; the card must
  // show a message the client can act on, not one generic "try again" for all.
  function mockCheckout(status: number, error: string) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: status >= 200 && status < 300,
      json: async () => ({ error }),
    } as Response);
  }

  async function clickPayAndReadError(): Promise<string> {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.Portal.pay_now) }));
    let text = "";
    await waitFor(() => {
      const el = document.querySelector("p.text-destructive");
      expect(el).toBeTruthy();
      text = el?.textContent ?? "";
    });
    return text;
  }

  it("tells the client the firm can't accept payments (not retryable)", async () => {
    mockCheckout(409, "not_accepting_payments");
    renderCard();
    expect(await clickPayAndReadError()).toBe(
      en.Portal.pay_error_unavailable.replace("{firm}", "Acme"),
    );
  });

  it("maps a missing Stripe platform config to the same 'unavailable' message", async () => {
    mockCheckout(503, "stripe_not_configured");
    renderCard();
    expect(await clickPayAndReadError()).toBe(
      en.Portal.pay_error_unavailable.replace("{firm}", "Acme"),
    );
  });

  it("tells the client the invoice was already handled", async () => {
    mockCheckout(409, "no_open_request");
    renderCard();
    expect(await clickPayAndReadError()).toBe(en.Portal.pay_error_no_request);
  });

  it("tells the client the link is dead for an expired/cancelled engagement", async () => {
    mockCheckout(400, "expired");
    renderCard();
    expect(await clickPayAndReadError()).toBe(
      en.Portal.pay_error_link.replace("{firm}", "Acme"),
    );
  });

  it("shows a wait-and-retry message when rate limited", async () => {
    mockCheckout(429, "rate_limited");
    renderCard();
    expect(await clickPayAndReadError()).toBe(en.Portal.pay_error_busy);
  });

  it("shows a distinct provider message (retry + contact firm) on a Stripe error", async () => {
    mockCheckout(502, "stripe_error");
    renderCard();
    expect(await clickPayAndReadError()).toBe(
      en.Portal.pay_error_provider.replace("{firm}", "Acme"),
    );
  });

  it("falls back to the generic retryable message on an unknown/network error", async () => {
    mockCheckout(500, "something_unexpected");
    renderCard();
    expect(await clickPayAndReadError()).toBe(en.Portal.pay_error);
  });
});
