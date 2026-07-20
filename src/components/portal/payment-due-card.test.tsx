import React from "react";
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

// Stub the PayPal button (its SDK/script lifecycle is tested separately) so the
// card's method-choice logic is what these tests exercise.
vi.mock("./portal-paypal-button", () => ({
  PortalPayPalButton: ({ config }: { config: { merchantId: string } }) =>
    React.createElement(
      "div",
      { "data-testid": "paypal-button" },
      `paypal:${config.merchantId}`,
    ),
}));

const PAYPAL_CONFIG = {
  merchantId: "SELLER1",
  clientId: "client-1",
  partnerAttributionId: null,
  sdkUrl: "https://www.sandbox.paypal.com/web-sdk/v6/core",
  environment: "sandbox" as const,
};

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

  it("renders the full invoice detail + PDF link for a GENERATED invoice", () => {
    renderCard({
      amount_cents: 34493,
      invoice_kind: "generated",
      invoice_number: "INV-0012",
      line_items: [
        { description: "T1 return", quantity: 1, unit_cents: 20000, amount_cents: 20000 },
        { description: "", quantity: 2, unit_cents: 5000, amount_cents: 10000 },
      ],
      tax_breakdown: [
        {
          component: "GST",
          rate_milli_pct: 5000,
          registration_kind: "gst",
          base_cents: 30000,
          amount_cents: 1500,
          registration_number: "123456789 RT0001",
        },
        {
          component: "QST",
          rate_milli_pct: 9975,
          registration_kind: "qst",
          base_cents: 30000,
          amount_cents: 2993,
          registration_number: null,
        },
      ],
      subtotal_cents: 30000,
      tax_total_cents: 4493,
      invoice_terms: "Due on receipt",
      invoice_language: "en",
    });
    // Number in the header subtitle; line items with the empty-description
    // fallback; tax lines with the registration number; totals; PDF link.
    expect(screen.getByText(/· INV-0012/)).toBeInTheDocument();
    expect(screen.getByText("T1 return")).toBeInTheDocument();
    expect(screen.getByText("Professional services")).toBeInTheDocument();
    expect(screen.getByText("GST (5%)")).toBeInTheDocument();
    expect(screen.getByText("No. 123456789 RT0001")).toBeInTheDocument();
    expect(screen.getByText(en.Portal.pay_subtotal)).toBeInTheDocument();
    expect(screen.getByText("$300.00")).toBeInTheDocument();
    expect(screen.getByText("Due on receipt")).toBeInTheDocument();
    const pdfLink = screen.getByText("INV-0012.pdf").closest("a");
    expect(pdfLink?.getAttribute("href")).toBe(
      "/api/portal/invoices/pr1/pdf?token=tok_test&download=1",
    );
    // Pay button still present.
    expect(
      screen.getByRole("button", { name: new RegExp(en.Portal.pay_now) }),
    ).toBeInTheDocument();
  });

  it("keeps the simple card for legacy invoices (no detail table)", () => {
    renderCard({ description: "2025 return" });
    expect(screen.getByText(/2025 return/)).toBeInTheDocument();
    expect(screen.queryByText(en.Portal.pay_subtotal)).not.toBeInTheDocument();
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

  it("maps an unusable connected account (mode mismatch) to 'unavailable'", async () => {
    mockCheckout(409, "account_unusable");
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

  it("Stripe-only (no PayPal): the secured line still credits Stripe", () => {
    renderCard();
    expect(screen.getByText(en.Portal.pay_secured)).toBeInTheDocument();
    expect(screen.queryByTestId("paypal-button")).not.toBeInTheDocument();
  });
});

// Method choice (Phase 3): what the card offers depends on which rails the firm
// has connected. The Stripe-only path above stays byte-for-byte unchanged.
function renderWithRails(
  opts: {
    stripeReady?: boolean;
    paypal?: typeof PAYPAL_CONFIG | null;
    status?: PR["status"];
    justReturnedProcessing?: boolean;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PaymentDueCard
        token="tok_test"
        paymentRequest={{ ...BASE, status: opts.status ?? "requested" }}
        firmName="Acme"
        locale="en"
        justReturnedPaid={false}
        justReturnedProcessing={opts.justReturnedProcessing ?? false}
        stripeReady={opts.stripeReady ?? true}
        paypal={opts.paypal ?? null}
      />
    </NextIntlClientProvider>,
  );
}

describe("PaymentDueCard — method choice", () => {
  it("both rails: shows Pay by card, an 'or' divider, and the PayPal button", () => {
    renderWithRails({ stripeReady: true, paypal: PAYPAL_CONFIG });
    expect(
      screen.getByRole("button", { name: new RegExp(en.Portal.pay_by_card) }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.Portal.pay_or)).toBeInTheDocument();
    expect(screen.getByTestId("paypal-button")).toHaveTextContent(
      "paypal:SELLER1",
    );
    // The old inline "Pay now" is not used in the two-rail layout.
    expect(
      screen.queryByRole("button", { name: new RegExp(`^${en.Portal.pay_now}$`) }),
    ).not.toBeInTheDocument();
  });

  it("PayPal-only (Stripe not ready): shows ONLY the PayPal button, no card button or divider", () => {
    renderWithRails({ stripeReady: false, paypal: PAYPAL_CONFIG });
    expect(screen.getByTestId("paypal-button")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(en.Portal.pay_by_card) }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(en.Portal.pay_or)).not.toBeInTheDocument();
  });

  it("with PayPal present, the secured line drops the 'by Stripe' claim", () => {
    renderWithRails({ stripeReady: true, paypal: PAYPAL_CONFIG });
    expect(screen.getByText(en.Portal.pay_secured_generic)).toBeInTheDocument();
    expect(screen.queryByText(en.Portal.pay_secured)).not.toBeInTheDocument();
  });

  it("PayPal PENDING return shows the processing state, not due or paid", () => {
    renderWithRails({
      paypal: PAYPAL_CONFIG,
      status: "requested",
      justReturnedProcessing: true,
    });
    expect(
      screen.getByText(en.Portal.pay_processing_title),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(en.Portal.pay_by_card) }),
    ).not.toBeInTheDocument();
  });

  it("a paid invoice ignores the processing flag and shows the thank-you", () => {
    renderWithRails({
      paypal: PAYPAL_CONFIG,
      status: "paid",
      justReturnedProcessing: true,
    });
    expect(screen.getByText(en.Portal.pay_received_title)).toBeInTheDocument();
  });
});
