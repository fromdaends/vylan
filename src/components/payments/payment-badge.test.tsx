import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { PaymentBadge } from "./payment-badge";
import type { PaymentRequestStatus } from "@/lib/db/payment-requests";

afterEach(() => cleanup());

function renderBadge(status: PaymentRequestStatus) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PaymentBadge status={status} />
    </NextIntlClientProvider>,
  );
}

describe("PaymentBadge", () => {
  it("shows Paid for a paid request", () => {
    renderBadge("paid");
    expect(screen.getByText(en.Engagements.pay_badge_paid)).toBeInTheDocument();
  });

  it("shows Unpaid for a requested-but-unpaid request", () => {
    renderBadge("requested");
    expect(
      screen.getByText(en.Engagements.pay_badge_unpaid),
    ).toBeInTheDocument();
  });

  it("shows Failed for a failed request", () => {
    renderBadge("failed");
    expect(
      screen.getByText(en.Engagements.pay_badge_failed),
    ).toBeInTheDocument();
  });

  it("renders nothing for a canceled request", () => {
    const { container } = renderBadge("canceled");
    expect(container).toBeEmptyDOMElement();
  });
});
