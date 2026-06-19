import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { PaymentsList } from "./payments-list";
import type { PaymentsListRow } from "@/lib/db/payment-requests";

afterEach(() => cleanup());

const ROW: PaymentsListRow = {
  id: "p1",
  status: "paid",
  amountCents: 35000,
  currency: "cad",
  createdAt: "2026-06-19T00:00:00.000Z",
  clientName: "Tyler Jette",
  engagementTitle: "2025 return",
};

function renderList(rows: PaymentsListRow[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PaymentsList rows={rows} />
    </NextIntlClientProvider>,
  );
}

describe("PaymentsList", () => {
  it("renders a row with the engagement, amount, and a Paid badge", () => {
    renderList([ROW]);
    expect(screen.getByText("2025 return")).toBeInTheDocument();
    expect(screen.getByText(/\$350\.00/)).toBeInTheDocument();
    expect(screen.getByText(en.Engagements.pay_badge_paid)).toBeInTheDocument();
  });

  it("shows the empty state when there are no payments", () => {
    renderList([]);
    expect(
      screen.getByText(en.Engagements.payments_list_empty),
    ).toBeInTheDocument();
  });
});
