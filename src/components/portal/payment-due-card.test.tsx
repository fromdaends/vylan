import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { PaymentDueCard } from "./payment-due-card";

afterEach(() => cleanup());

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

  it("renders nothing for a canceled request", () => {
    const { container } = renderCard({ status: "canceled" });
    expect(container).toBeEmptyDOMElement();
  });
});
